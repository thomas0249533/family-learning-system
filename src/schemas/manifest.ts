export interface LearningPackageManifest {
  schemaVersion: '1.0';
  packageId: string;
  packageType: 'base' | 'unit' | 'term' | 'special' | 'sprint' | 'mistake' | 'daily';
  subject: 'math' | 'chinese' | 'english';
  templateId: string;
  grade: number;
  term: 'up' | 'down';
  edition?: string;
  title: string;
  subtitle?: string;
  theme?: { primary?: string };
  dependencies?: string[];
  author?: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}
