import {
  type BomQuoteSearchRequirementsBodyType,
  type BomQuoteSearchRequirementsType,
} from '@sp/api-contract';
import { z } from 'zod';
import { engineFetch } from './engine-client';

const EngineSearchRequirementValidation = z.object({
  policy_version: z.literal('bom-search-requirement-policy-v1'),
  valid: z.boolean(),
  requirements: z.record(z.string(), z.unknown()).nullable(),
  errors: z.array(z.object({
    field: z.string(),
    code: z.enum([
      'invalid_shape',
      'missing_required',
      'field_not_applicable',
      'invalid_value',
      'invalid_combination',
      'unsupported_version',
    ]),
    message: z.string(),
  })),
});

export type EngineSearchRequirementIssue = z.infer<
  typeof EngineSearchRequirementValidation
>['errors'][number];

export type EngineSearchRequirementValidationResult =
  | { status: 'valid' }
  | { status: 'invalid'; errors: EngineSearchRequirementIssue[] }
  | { status: 'unavailable'; error: string };

const ENGINE_KEY_OVERRIDES: Readonly<Record<string, string>> = {
  packageCode: 'package',
};

function engineFieldName(field: string): string {
  return ENGINE_KEY_OVERRIDES[field]
    ?? field.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLocaleLowerCase('en-US')}`);
}

/**
 * 공개 camelCase 계약을 엔진 snake_case 입력으로 옮기는 기계적 어댑터.
 * 부품별 필수값·허용 조합은 여기서 판정하지 않고 sp-engine에 맡긴다.
 */
export function toEngineSearchRequirements(
  requirements:
    | BomQuoteSearchRequirementsBodyType
    | BomQuoteSearchRequirementsType,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(requirements)
      .filter(([field]) => field !== 'updatedAt' && field !== 'updatedBy')
      .map(([field, value]) => [engineFieldName(field), value]),
  );
}

/** 저장 전에 sp-engine의 단일 정책 원본으로 기술 조건을 검증한다. */
export async function validateEngineSearchRequirements(
  requirements: BomQuoteSearchRequirementsType,
): Promise<EngineSearchRequirementValidationResult> {
  let response: Response;
  try {
    response = await engineFetch('/supplier-search/requirements/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requirements: toEngineSearchRequirements(requirements),
      }),
    });
  } catch (error) {
    return { status: 'unavailable', error: String(error) };
  }
  if (!response.ok) {
    return {
      status: 'unavailable',
      error: `engine_requirement_validation_http_${String(response.status)}`,
    };
  }
  const parsed = EngineSearchRequirementValidation.safeParse(await response.json());
  if (!parsed.success) {
    return {
      status: 'unavailable',
      error: 'engine_requirement_validation_contract_invalid',
    };
  }
  return parsed.data.valid
    ? { status: 'valid' }
    : { status: 'invalid', errors: parsed.data.errors };
}
