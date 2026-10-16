export interface KnowledgePoint {
  id: string;
  type: 'concept' | 'formula' | 'derivation' | 'example' | 'mistake' | 'word' | 'poem' | 'grammar';
  title: string;
  content: string;
  media?: Array<{ type: string; src: string }>;
  exerciseIds?: string[];
  metadata?: {
    difficulty?: number;
    cognitiveLevel?: string;
    estimatedMinutes?: number;
    source?: string;
    ability?: string[];
  };
  prerequisites?: string[];
  tags?: string[];
}