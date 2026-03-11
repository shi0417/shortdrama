export type WorldviewClosureModuleKey =
  | 'payoff'
  | 'opponents'
  | 'power'
  | 'traitor'
  | 'story_phase'
  | 'evidence';

export type WorldviewValidationSeverity = 'fatal' | 'major' | 'minor';

export type WorldviewRepairStrategy =
  | 'fix_in_place'
  | 'regenerate_module'
  | 'reselect_evidence';

export type WorldviewIssueSource =
  | 'structure'
  | 'semantic'
  | 'relevance'
  | 'alignment';

export type WorldviewValidationIssue = {
  moduleKey: WorldviewClosureModuleKey;
  path: string;
  severity: WorldviewValidationSeverity;
  reason: string;
  repairStrategy: WorldviewRepairStrategy;
  source: WorldviewIssueSource;
};

export type WorldviewValidationRecommendedAction =
  | 'accept'
  | 'repair'
  | 'regenerate_modules'
  | 'reselect_evidence';

export type WorldviewValidationReport = {
  passed: boolean;
  score: number;
  fatalCount: number;
  majorCount: number;
  minorCount: number;
  issues: WorldviewValidationIssue[];
  recommendedAction: WorldviewValidationRecommendedAction;
};

export type WorldviewRepairActionType =
  | 'accept'
  | 'repair'
  | 'regenerate_modules';

export type WorldviewRepairPlan = {
  actionType: WorldviewRepairActionType;
  targetModules: WorldviewClosureModuleKey[];
  repairInstructions: string[];
  needsEvidenceReselect: boolean;
};

export type WorldviewClosureStatus = 'accepted' | 'repaired' | 'low_confidence';

export type WorldviewRepairSummary = {
  actionType: WorldviewRepairActionType;
  targetModules: WorldviewClosureModuleKey[];
  issueCountBefore: number;
  issueCountAfter: number;
  scoreBefore: number;
  scoreAfter: number;
};

export type WorldviewClosureResult = {
  closureStatus: WorldviewClosureStatus;
  repairApplied: boolean;
  evidenceReselected: boolean;
  repairSummary: WorldviewRepairSummary;
  initialValidationReport: WorldviewValidationReport;
  finalValidationReport: WorldviewValidationReport;
};

