// PCB EQ 엑셀 → 문항 초안(D20 P2) 공개 면. 정본 docs/PCB_EQ_AI_PROBE.md.
//  추출(extractEqWorkbook) → 직렬화(serializeForLlm) → 프롬프트(buildEqParsePrompt 'eq-parse-v2' + EQ_DRAFT_JSON_SCHEMA)
//  → parseEqJson(extractJsonObject) → coerceEqDraft(→ PcbEqDraft) → [대조·보충: parseEqTemplate] → findDroppedFacts
// 권장 기본값(프로빙 §7.1): kimi-k3 · think low · eq-parse-v2 · temperature 0.
export { extractEqWorkbook } from './extract';
export { serializeForLlm } from './serialize';
export { parseEqTemplate, type EqTemplateResult, type EqTemplateLayout } from './template';
export {
  EQ_DRAFT_JSON_SCHEMA,
  EQ_PARSE_PROMPT_VERSION,
  EQ_PARSE_PROMPT_VERSIONS,
  EQ_TRANSLATE_JSON_SCHEMA,
  EQ_TRANSLATE_PROMPT_VERSION,
  buildEqParsePrompt,
  buildEqTranslatePrompt,
  coerceEqDraft,
  findDroppedFacts,
  mergeTranslation,
  parseEqJson,
  type EqParsePromptVersion,
} from './prompt';
export { EQ_GLOSSARY } from './glossary';
export { EQ_EXTRACT_LIMITS, type EqExtract, type EqImage, type EqSheet } from './types';
