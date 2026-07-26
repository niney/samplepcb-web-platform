import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { esClient } from '../es/client';
import { SP_PARTS_WRITE, bootstrapPartsIndex } from '../es/sp-parts-index';
import { prisma } from '../lib/prisma';
import { applyPartFacts, tryIndexPart } from '../lib/parts-ingest';
import { refreshPartsIndex } from '../lib/parts-es';
import { resolveManufacturer } from '../lib/manufacturer-alias';

// 제조사 별칭 통합 뒤 남은 과거 행을 정규 키 행으로 병합한다.
//
// `manufacturer-alias.ts`에 별칭을 추가하면 이후 인제스트만 정규 키로 모이고, 이미 저장된
// 행의 `manufacturerNorm`은 그대로 남아 같은 부품이 둘로 보인다. 이 스크립트는 그 과거 행의
// 오퍼·견적 연결을 정규 키 행으로 옮기고 과거 행을 지운다.
//
// 대상은 `--supplier`가 지정한 공급사의 오퍼를 가진 정규 키 부품과 같은 MPN인 행으로만
// 한정한다. 전체 카탈로그를 한 번에 건드리지 않기 위한 안전 경계다.
// `--apply`는 전체 계획을 manifest에 먼저 남긴다. DB source 삭제 뒤 프로세스나 ES가
// 실패해도 같은 명령 재실행이 target 재색인과 source ES 문서 삭제를 이어간다.

interface Options {
  apply: boolean;
  manifest: string;
  suppliers: string[];
}

interface MergePlan {
  mpnNorm: string;
  targetId: bigint;
  targetKey: string;
  sourceId: bigint;
  sourceKey: string;
  sourceName: string;
  movedOffers: number;
  droppedOffers: number;
  quoteItems: number;
}

const StoredMergePlanSchema = z.object({
  mpnNorm: z.string(),
  targetId: z.string().regex(/^\d+$/),
  targetKey: z.string(),
  sourceId: z.string().regex(/^\d+$/),
  sourceKey: z.string(),
  sourceName: z.string(),
  movedOffers: z.number().int().nonnegative(),
  droppedOffers: z.number().int().nonnegative(),
  quoteItems: z.number().int().nonnegative(),
});

const MergeStateSchema = z.object({
  version: z.literal(1),
  suppliers: z.array(z.string().min(1)),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  plans: z.array(StoredMergePlanSchema),
});

type MergeState = z.infer<typeof MergeStateSchema>;

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseOptions(args: string[]): Options {
  const suppliers = (optionValue(args, '--supplier') ?? '')
    // PowerShell에서 따옴표 없는 쉼표 목록은 pnpm을 거치며 공백으로 합쳐질 수 있다.
    // 운영 문서의 동일 명령이 bash·PowerShell 모두에서 같은 공급사 집합이 되게 한다.
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (suppliers.length === 0) {
    throw new Error('--supplier 로 기준 공급사를 하나 이상 지정하세요 (쉼표 구분)');
  }
  const canonicalSuppliers = [...new Set(suppliers)].sort();
  const manifest = path.resolve(
    optionValue(args, '--manifest')
      ?? path.join('.tmp', `manufacturer-key-merge-${canonicalSuppliers.join('-')}.json`),
  );
  return { apply: args.includes('--apply'), manifest, suppliers: canonicalSuppliers };
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? String(item) : item, 2);
}

function storedPlan(plan: MergePlan): z.infer<typeof StoredMergePlanSchema> {
  return {
    ...plan,
    targetId: String(plan.targetId),
    sourceId: String(plan.sourceId),
  };
}

function runtimePlan(plan: z.infer<typeof StoredMergePlanSchema>): MergePlan {
  return {
    ...plan,
    targetId: BigInt(plan.targetId),
    sourceId: BigInt(plan.sourceId),
  };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeState(file: string, state: MergeState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${json(state)}\n`, 'utf8');
}

async function ensureMergeState(
  file: string,
  suppliers: string[],
  plans: MergePlan[],
): Promise<MergeState> {
  if (await fileExists(file)) {
    const current = MergeStateSchema.parse(JSON.parse(await readFile(file, 'utf8')) as unknown);
    if (current.suppliers.join('\u0000') !== suppliers.join('\u0000')) {
      throw new Error(`다른 공급사 집합의 병합 상태 파일입니다: ${file}`);
    }
    if (current.completedAt === null) {
      const known = new Set(current.plans.map((plan) => plan.sourceId));
      const added = plans.filter((plan) => !known.has(String(plan.sourceId))).map(storedPlan);
      if (added.length > 0) {
        current.plans.push(...added);
        await writeState(file, current);
      }
      return current;
    }
    if (plans.length === 0) return current;
    const archive = `${file}.${current.completedAt.replace(/[:.]/g, '-')}.bak`;
    await rename(file, archive);
  }
  const state: MergeState = {
    version: 1,
    suppliers,
    createdAt: new Date().toISOString(),
    completedAt: null,
    plans: plans.map(storedPlan),
  };
  // DB를 건드리기 전에 삭제할 source ID를 모두 영속화한다. 중간 실패 뒤 source 행이
  // 이미 사라졌더라도 재실행이 ES 유령 문서를 끝까지 지울 수 있다.
  await writeState(file, state);
  return state;
}

/** 기준 공급사 오퍼를 가진 부품과 같은 MPN이면서, 별칭 해소 시 같은 키가 되는 과거 행을 찾는다. */
async function buildPlans(suppliers: string[]): Promise<MergePlan[]> {
  const anchorOffers = await prisma.spPartOffer.findMany({
    where: { supplier: { in: suppliers } },
    select: { partId: true },
    distinct: ['partId'],
  });
  const anchorIds = anchorOffers.map((offer) => offer.partId);
  if (anchorIds.length === 0) return [];

  const targets = await prisma.spPart.findMany({
    where: { id: { in: anchorIds } },
    select: { id: true, mpnNorm: true, manufacturerNorm: true, manufacturerName: true },
  });
  // 정규 키 = 자기 표시명을 별칭 해소한 결과와 같은 행만 병합 목적지가 될 수 있다.
  const canonical = targets.filter(
    (part) => resolveManufacturer(part.manufacturerName).norm === part.manufacturerNorm,
  );
  const targetByKey = new Map(
    canonical.map((part) => [`${part.manufacturerNorm}\u0000${part.mpnNorm}`, part]),
  );

  const plans: MergePlan[] = [];
  const mpns = [...new Set(canonical.map((part) => part.mpnNorm))];
  for (let offset = 0; offset < mpns.length; offset += 500) {
    const batch = mpns.slice(offset, offset + 500);
    const candidates = await prisma.spPart.findMany({
      where: { mpnNorm: { in: batch }, id: { notIn: canonical.map((part) => part.id) } },
      include: { offers: { select: { id: true, supplier: true, supplierSku: true, fetchedAt: true } } },
    });
    for (const source of candidates) {
      const resolvedManufacturer = resolveManufacturer(source.manufacturerName).norm;
      const target = targetByKey.get(`${resolvedManufacturer}\u0000${source.mpnNorm}`);
      if (target === undefined) continue;
      if (source.manufacturerNorm === target.manufacturerNorm) continue;
      // 표시명을 별칭 해소했을 때 목적지와 같은 회사여야만 병합한다.
      if (resolvedManufacturer !== target.manufacturerNorm) continue;

      const targetOffers = await prisma.spPartOffer.findMany({
        where: { partId: target.id },
        select: { supplier: true, supplierSku: true },
      });
      const taken = new Set(targetOffers.map((offer) => `${offer.supplier}:${offer.supplierSku}`));
      const moved = source.offers.filter((offer) => !taken.has(`${offer.supplier}:${offer.supplierSku}`));
      const quoteItems = await prisma.spBomQuoteItem.count({ where: { partId: source.id } });
      plans.push({
        mpnNorm: source.mpnNorm,
        targetId: target.id,
        targetKey: `${target.manufacturerNorm}:${target.mpnNorm}`,
        sourceId: source.id,
        sourceKey: `${source.manufacturerNorm}:${source.mpnNorm}`,
        sourceName: source.manufacturerName,
        movedOffers: moved.length,
        droppedOffers: source.offers.length - moved.length,
        quoteItems,
      });
    }
  }
  return plans.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

async function mergeOne(plan: MergePlan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const targetOffers = await tx.spPartOffer.findMany({
      where: { partId: plan.targetId },
      select: { supplier: true, supplierSku: true },
    });
    const taken = new Set(targetOffers.map((offer) => `${offer.supplier}:${offer.supplierSku}`));
    const sourceOffers = await tx.spPartOffer.findMany({
      where: { partId: plan.sourceId },
      select: { id: true, supplier: true, supplierSku: true },
    });
    for (const offer of sourceOffers) {
      // 같은 (supplier, sku)가 목적지에 이미 있으면 목적지 값이 정본이다 — 과거 행 것을 버린다.
      if (taken.has(`${offer.supplier}:${offer.supplierSku}`)) continue;
      await tx.spPartOffer.update({ where: { id: offer.id }, data: { partId: plan.targetId } });
    }
    await tx.spBomQuoteItem.updateMany({
      where: { partId: plan.sourceId },
      data: { partId: plan.targetId },
    });
    await tx.spPartIndexQueue.deleteMany({ where: { partId: plan.sourceId } });
    // 남은 오퍼(중복분)와 가격구간은 부품 삭제 cascade로 정리된다.
    await tx.spPart.delete({ where: { id: plan.sourceId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
}

function mergeSummary(options: Options, plans: MergePlan[]): Record<string, unknown> {
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    suppliers: options.suppliers,
    mergeParts: plans.length,
    movedOffers: plans.reduce((total, plan) => total + plan.movedOffers, 0),
    droppedDuplicateOffers: plans.reduce((total, plan) => total + plan.droppedOffers, 0),
    relinkedQuoteItems: plans.reduce((total, plan) => total + plan.quoteItems, 0),
    byKeyPair: Object.fromEntries(
      [...plans.reduce((counts, plan) => {
        const key = `${plan.sourceKey.split(':')[0] ?? ''} → ${plan.targetKey.split(':')[0] ?? ''}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())].sort(),
    ),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const discoveredPlans = await buildPlans(options.suppliers);

  if (!options.apply) {
    console.log(json({
      result: true,
      ...mergeSummary(options, discoveredPlans),
      manifest: options.manifest,
      samples: discoveredPlans.slice(0, 10),
    }));
    return;
  }

  const state = await ensureMergeState(options.manifest, options.suppliers, discoveredPlans);
  const plans = state.plans.map(runtimePlan);
  const summary = mergeSummary(options, plans);
  if (state.completedAt !== null && discoveredPlans.length === 0) {
    console.log(json({
      result: true,
      reused: true,
      ...summary,
      manifest: options.manifest,
      completedAt: state.completedAt,
      remainingMergeParts: 0,
    }));
    return;
  }

  await bootstrapPartsIndex(console);
  for (const plan of plans) {
    const target = await prisma.spPart.findUnique({
      where: { id: plan.targetId },
      select: { id: true },
    });
    if (target === null) throw new Error(`병합 목적지 부품이 없습니다: ${plan.targetKey}`);
    const source = await prisma.spPart.findUnique({
      where: { id: plan.sourceId },
      select: { id: true },
    });
    if (source !== null) await mergeOne(plan);
    await applyPartFacts(plan.targetId);
    if (!await tryIndexPart(plan.targetId, { force: true })) {
      throw new Error(`병합 후 재색인 실패: ${plan.targetKey}`);
    }
  }
  const deletedIds = plans.map((plan) => plan.sourceId);
  if (deletedIds.length > 0) {
    const response = await esClient().bulk({
      refresh: false,
      operations: deletedIds.map((id) => ({ delete: { _index: SP_PARTS_WRITE, _id: String(id) } })),
    });
    const failures = response.items.filter((item) => {
      const operation = item.delete;
      return operation?.error !== undefined && operation.status !== 404;
    });
    if (failures.length > 0) throw new Error(`ES 과거 문서 삭제 실패 ${String(failures.length)}건`);
    await refreshPartsIndex();
  }

  // 검증 — 병합 대상이 남아 있지 않아야 한다.
  const remaining = await buildPlans(options.suppliers);
  if (remaining.length === 0) {
    state.completedAt = new Date().toISOString();
    await writeState(options.manifest, state);
  } else {
    const known = new Set(state.plans.map((plan) => plan.sourceId));
    state.plans.push(
      ...remaining.filter((plan) => !known.has(String(plan.sourceId))).map(storedPlan),
    );
    await writeState(options.manifest, state);
  }
  console.log(json({
    result: remaining.length === 0,
    ...summary,
    manifest: options.manifest,
    deletedParts: deletedIds.length,
    remainingMergeParts: remaining.length,
  }));
  if (remaining.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
