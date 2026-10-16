import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import manifestSchema from '../../../docs/spec/manifest.schema.json';
import kpSchema from '../../../docs/spec/knowledge-point.schema.json';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// 编译验证器
const validateManifest = ajv.compile(manifestSchema);
const validateKnowledgePoint = ajv.compile(kpSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePackageManifest(data: any): ValidationResult {
  const valid = validateManifest(data);
  return {
    valid: !!valid,
    errors: valid ? [] : (validateManifest.errors || []).map(e => `${e.instancePath} ${e.message}`)
  };
}

export function validateKnowledgePoints(data: any[]): ValidationResult {
  const errors: string[] = [];
  data.forEach((kp, index) => {
    const valid = validateKnowledgePoint(kp);
    if (!valid) {
      (validateKnowledgePoint.errors || []).forEach(e => {
        errors.push(`知识点[${index}] ${e.instancePath} ${e.message}`);
      });
    }
  });
  return { valid: errors.length === 0, errors };
}