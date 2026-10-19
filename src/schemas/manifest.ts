export type PackageType =
  | 'base'
  | 'unit'
  | 'term'
  | 'special'
  | 'sprint'
  | 'mistake'
  | 'daily';

export interface LearningPackageManifest {
  schemaVersion: '1.0';
  packageId: string;
  /**
   * 包类型。**运行时 JSON 里实际字段名是 `type`**（`content/<集合>/packages/<pack>.json`
   * 全部只写 `type`），`packageType` 是历史别名。两个都声明为可选，因为真实数据里
   * 只有一个在场 —— 读取一律走 `packageTypeOf()`，不要直接摸字段（否则拿到 `undefined`）。
   */
  packageType?: PackageType;
  type?: PackageType;
  subject: 'math' | 'chinese' | 'english';
  templateId?: string;
  grade: number;
  term: 'up' | 'down';
  edition?: string;
  title: string;
  subtitle?: string;
  theme?: { primary?: string };
  dependencies?: string[];
  /** 考试模式：为 `true` 时进入 ExamPanel（题目导航、无阅读模块） */
  examMode?: boolean;
  /**
   * 专项/冲刺包：本包题目来自哪些单元，元素形如 `<packageId>::<unitId>`。
   * 这是**单元级**的精确来源映射（比 `dependencies` 的"整包聚合"细一层），
   * 用于 `resolvePackageUnits` 的三段式解析。
   */
  sourceUnitIds?: string[];
  author?: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

/**
 * 读包类型。`packageType` 优先，回退 `type`（运行时数据普遍只写后者）。
 *
 * 单独导出而不是各处写 `manifest.packageType ?? manifest.type`：
 * 这个 `??` 一旦漏写就会静默拿到 `undefined`，而所有 `type === 'unit'` 之类的判断
 * 都会静默走 else 分支 —— 是本项目最容易"看起来正常其实全错"的一类 bug。
 */
export function packageTypeOf(
  manifest: LearningPackageManifest | undefined | null
): PackageType | undefined {
  if (!manifest) return undefined;
  return manifest.packageType ?? manifest.type;
}
