/**
 * Copyright (c) 2025 Mihajlo Stojanovski
 * All rights reserved.
 */

import { Rule, RuleContext, Finding, CAPS } from "../../types";
import { LocatorTimeoutRule } from "./common/locator-timeout";
import { NavigationTimeoutRule } from "./common/navigation-timeout";
import { ContextDestroyedRule } from "./common/context-destroyed";
import { NetworkErrorRule } from "./common/network-error";
import { AssertionMismatchRule } from "./common/assertion-mismatch";
import { TestTimeoutRule } from "./common/test-timeout";
import { PageClosedRule } from "./common/page-closed";
import { WorkerInfraRule } from "./common/worker-infra";
import { ApiResponseRule } from "./common/api-response";
import { ElementInterceptRule } from "./common/element-intercept";
import { UnknownErrorRule } from "./common/unknown-error";

/**
 * Rule Registry
 * Enterprise principle: deterministic, ordered, capped.
 */
export class RuleRegistry {
  private rules: Rule[] = [];

  /**
   * Initialize the rule registry and register all built-in rules
   * Rules are automatically sorted by priority (higher priority runs first)
   */
  constructor() {
    // Register all rules in priority order
    this.register(new LocatorTimeoutRule());
    this.register(new NavigationTimeoutRule());
    this.register(new ContextDestroyedRule());
    this.register(new NetworkErrorRule());
    this.register(new AssertionMismatchRule());
    this.register(new TestTimeoutRule());
    this.register(new PageClosedRule());
    this.register(new WorkerInfraRule());
    this.register(new ApiResponseRule());
    this.register(new ElementInterceptRule());
    this.register(new UnknownErrorRule()); // Fallback last
  }

  /**
   * Register a new rule in the registry
   * Rules are automatically sorted by priority after registration
   *
   * @param rule - Rule implementation to register
   */
  register(rule: Rule): void {
    this.rules.push(rule);
    // Sort by priority descending (higher = runs first)
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Evaluate all registered rules against a test context
   * Returns findings in deterministic priority order, capped per test
   * Ensures at least one finding (fallback to unknown-error if needed)
   *
   * @param ctx - Rule context containing test result and analysis data
   * @returns Array of findings (max CAPS.MAX_FINDINGS_PER_TEST)
   */
  evaluate(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    let matchedNonFallback = false;

    for (const rule of this.rules) {
      // Skip fallback if we have matches
      if (rule.id === "unknown-error" && matchedNonFallback) {
        continue;
      }

      if (rule.match(ctx)) {
        const ruleFindings = rule.build(ctx);
        findings.push(...ruleFindings);

        if (rule.id !== "unknown-error") {
          matchedNonFallback = true;
        }

        // Cap findings per test
        if (findings.length >= CAPS.MAX_FINDINGS_PER_TEST) {
          break;
        }
      }
    }

    // Ensure at least one finding (fallback)
    if (findings.length === 0 && ctx.test.status === "failed") {
      const fallback = new UnknownErrorRule();
      findings.push(...fallback.build(ctx));
    }

    // Sort by confidence descending
    findings.sort((a, b) => b.confidence - a.confidence);

    return findings.slice(0, CAPS.MAX_FINDINGS_PER_TEST);
  }

  /**
   * Get count of registered rules.
   */
  getRuleCount(): number {
    return this.rules.length;
  }

  /**
   * Get all rule IDs for documentation.
   */
  getRuleIds(): string[] {
    return this.rules.map((r) => r.id);
  }
}
