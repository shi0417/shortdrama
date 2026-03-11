import {
  WorldviewClosureModuleKey,
  WorldviewRepairPlan,
  WorldviewValidationIssue,
  WorldviewValidationReport,
} from './worldview-closure.types';

const MODULE_KEYS: WorldviewClosureModuleKey[] = [
  'payoff',
  'opponents',
  'power',
  'traitor',
  'story_phase',
  'evidence',
];

export class WorldviewRepairPlanner {
  buildPlan(report: WorldviewValidationReport): WorldviewRepairPlan {
    const hasReselectMajor = report.issues.some(
      (item) => item.repairStrategy === 'reselect_evidence' && item.severity !== 'minor',
    );
    const hasFatal = report.fatalCount > 0;
    const needsReselect = report.issues.some(
      (item) => item.repairStrategy === 'reselect_evidence',
    );

    if (
      !hasFatal &&
      report.majorCount <= 2 &&
      !hasReselectMajor &&
      report.score >= 80
    ) {
      return {
        actionType: 'accept',
        targetModules: [],
        repairInstructions: ['Validation passed, no repair needed'],
        needsEvidenceReselect: false,
      };
    }

    const regenModules = this.collectModules(report.issues, 'regenerate_module');
    const fixOnly = report.issues.filter((item) => item.repairStrategy === 'fix_in_place');
    const actionType: WorldviewRepairPlan['actionType'] = regenModules.length
      ? 'regenerate_modules'
      : 'repair';

    return {
      actionType,
      targetModules: regenModules,
      repairInstructions: [
        ...fixOnly.slice(0, 10).map((item) => `${item.path}: ${item.reason}`),
        ...regenModules.map((moduleKey) => `regenerate ${moduleKey} by semantic issues`),
      ],
      needsEvidenceReselect: needsReselect,
    };
  }

  private collectModules(
    issues: WorldviewValidationIssue[],
    strategy: WorldviewValidationIssue['repairStrategy'],
  ): WorldviewClosureModuleKey[] {
    const set = new Set<WorldviewClosureModuleKey>();
    issues.forEach((item) => {
      if (item.repairStrategy !== strategy) return;
      if (!MODULE_KEYS.includes(item.moduleKey)) return;
      if (item.moduleKey === 'evidence') return;
      set.add(item.moduleKey);
    });
    return [...set];
  }
}

