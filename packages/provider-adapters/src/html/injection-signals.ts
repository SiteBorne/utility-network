import type { EvidenceLocator } from '../types';
import { createLocator } from '../evidence/locators';

export interface PromptInjectionSignal {
  type: string;
  severity: 'low' | 'medium' | 'high';
  matchedRule: string;
  excerpt: string;
  locator: EvidenceLocator;
  policyRecommendation: 'monitor' | 'quarantine' | 'block';
}

export interface InjectionDetectionOptions {
  customRules?: Array<{
    type: string;
    regex: RegExp;
    severity: 'low' | 'medium' | 'high';
    recommendation: 'monitor' | 'quarantine' | 'block';
  }>;
  maxSignals?: number;
}

export const DEFAULT_INJECTION_RULES: Array<{
  type: string;
  regex: RegExp;
  severity: 'low' | 'medium' | 'high';
  recommendation: 'monitor' | 'quarantine' | 'block';
}> = [
  {
    type: 'ignore_instructions',
    regex: /ignore\s+(?:previous|prior|all)\s+instructions?/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'disregard_instructions',
    regex: /disregard\s+(?:previous|prior|all)\s+instructions?/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'override_instructions',
    regex: /override\s+(?:previous|prior|all)\s+(?:instructions?|prompts?)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'reveal_prompt',
    regex: /reveal\s+(?:your|the)\s+(?:system|prompt|instructions?|prompt\s+template)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'show_prompt',
    regex: /show\s+(?:me\s+)?(?:your|the)\s+(?:system|prompt|instructions?)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'print_prompt',
    regex: /print\s+(?:your|the)\s+(?:system|prompt|instructions?)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'output_prompt',
    regex: /output\s+(?:your|the)\s+(?:system|prompt|instructions?)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'execute_code',
    regex: /execute\s+(?:code|command|function|script)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'run_code',
    regex: /run\s+(?:code|command|script)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'eval_injection',
    regex: /\beval\s*\(/gi,
    severity: 'medium',
    recommendation: 'quarantine',
  },
  {
    type: 'function_constructor',
    regex: /new\s+Function\s*\(/gi,
    severity: 'medium',
    recommendation: 'quarantine',
  },
  {
    type: 'settimeout_injection',
    regex: /setTimeout\s*\(\s*["'][^"']*["']/gi,
    severity: 'medium',
    recommendation: 'quarantine',
  },
  {
    type: 'setinterval_injection',
    regex: /setInterval\s*\(\s*["'][^"']*["']/gi,
    severity: 'medium',
    recommendation: 'quarantine',
  },
  {
    type: 'exposed_secret',
    regex: /(?:password|secret|api[_-]?key|token|private[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/gi,
    severity: 'high',
    recommendation: 'quarantine',
  },
  {
    type: 'hidden_content_css',
    regex:
      /style\s*=\s*["'][^"']*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0|position:\s*absolute\s*;?\s*left:\s*-?\d+px)[^"']*["']/gi,
    severity: 'low',
    recommendation: 'monitor',
  },
  {
    type: 'zero_width_chars',
    regex: /[\u200B-\u200D\uFEFF]/g,
    severity: 'medium',
    recommendation: 'monitor',
  },
  { type: 'rtl_override', regex: /[\u202E\u202D]/g, severity: 'medium', recommendation: 'monitor' },
  {
    type: 'conflicting_instructions',
    regex:
      /(?:do\s+not|don't)\s+(?:follow|obey|listen\s+to)\s+(?:the\s+)?(?:above|previous|prior)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'act_as',
    regex:
      /\bact\s+as\s+(?:if\s+you\s+are\s+)?(?:a\s+)?(?:different|another|new)\s+(?:person|assistant|model|entity)/gi,
    severity: 'medium',
    recommendation: 'quarantine',
  },
  {
    type: 'pretend_to_be',
    regex: /pretend\s+(?:to\s+be|you\s+are)\s+(?:a\s+)?(?:different|another|new)/gi,
    severity: 'medium',
    recommendation: 'quarantine',
  },
  {
    type: 'ignore_guardrails',
    regex: /ignore\s+(?:guardrails?|safety|guidelines?|rules?|constraints?)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'bypass_safety',
    regex: /bypass\s+(?:safety|filter|moderation|guardrails?)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'jailbreak_attempt',
    regex: /(?:jailbreak|DAN|do\s+anything\s+now)/gi,
    severity: 'high',
    recommendation: 'block',
  },
  {
    type: 'system_prompt_leak',
    regex: /system\s+prompt\s*(?:is|:)/gi,
    severity: 'high',
    recommendation: 'block',
  },
];

export function detectPromptInjectionSignals(
  text: string,
  sourceUrl: string,
  options: InjectionDetectionOptions = {}
): PromptInjectionSignal[] {
  const rules = options.customRules
    ? [...DEFAULT_INJECTION_RULES, ...options.customRules]
    : DEFAULT_INJECTION_RULES;
  const maxSignals = options.maxSignals || 50;
  const signals: PromptInjectionSignal[] = [];

  for (const rule of rules) {
    let match;
    while ((match = rule.regex.exec(text)) !== null) {
      if (signals.length >= maxSignals) break;

      const start = Math.max(0, match.index - 100);
      const end = Math.min(text.length, match.index + match[0].length + 100);
      const excerpt = text.slice(start, end);

      signals.push({
        type: rule.type,
        severity: rule.severity,
        matchedRule: rule.type,
        excerpt,
        locator: createLocator('text_quote', excerpt, sourceUrl),
        policyRecommendation: rule.recommendation,
      });
    }
  }

  return signals;
}

export function detectHiddenContentSignals(
  html: string,
  sourceUrl: string
): PromptInjectionSignal[] {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    throw new Error(
      'detectHiddenContentSignals requires a DOM (JSDOM/Node) and is not available in the Worker production path. Hidden-content detection in production is performed by the HTMLRewriter normalization parser.'
    );
  }
  const signals: PromptInjectionSignal[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  for (const el of Array.from(
    doc.querySelectorAll(
      '[style*="display: none"], [style*="visibility: hidden"], [style*="opacity: 0"], [hidden]'
    )
  )) {
    const text = el.textContent?.trim();
    if (text && text.length > 20) {
      signals.push({
        type: 'hidden_content',
        severity: 'medium',
        matchedRule: 'hidden_element',
        excerpt: text.slice(0, 200),
        locator: createLocator('css_selector', getSelector(el), sourceUrl),
        policyRecommendation: 'quarantine',
      });
    }
  }

  for (const script of Array.from(
    doc.querySelectorAll('script:not([type="application/ld+json"])')
  )) {
    const content = script.textContent || '';
    if (
      content.includes('eval(') ||
      content.includes('new Function(') ||
      content.includes('setTimeout(') ||
      content.includes('setInterval(')
    ) {
      signals.push({
        type: 'dynamic_code_execution',
        severity: 'high',
        matchedRule: 'script_injection',
        excerpt: content.slice(0, 200),
        locator: createLocator('css_selector', getSelector(script), sourceUrl),
        policyRecommendation: 'block',
      });
    }
  }

  return signals;
}

function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const index = Array.from(current.parentElement?.children || []).indexOf(current);
    path.unshift(index >= 0 ? `${tag}:nth-child(${index + 1})` : tag);
    current = current.parentElement;
  }
  return path.join(' > ');
}

export function classifySignalSeverity(
  signals: PromptInjectionSignal[]
): 'low' | 'medium' | 'high' {
  if (signals.some((s) => s.severity === 'high')) return 'high';
  if (signals.some((s) => s.severity === 'medium')) return 'medium';
  return 'low';
}

export interface NormalizedHtmlInjectionSignal {
  type: string;
  severity: 'low' | 'medium' | 'high';
  excerpt: string;
  selector: string;
}

/**
 * Streaming-production scanner used by the HTMLRewriter-backed parser. Runs the
 * shared regex rule set over normalized visible text and maps to the
 * NormalizedHtmlResult.promptInjectionSignals shape. Deterministic, no DOM
 * globals required (unlike detectHiddenContentSignals, which needs JSDOM).
 */
export function runInjectionTextScan(
  text: string,
  options: InjectionDetectionOptions = {}
): NormalizedHtmlInjectionSignal[] {
  const signals = detectPromptInjectionSignals(text, '', options);
  return signals.map((s) => ({
    type: s.type,
    severity: s.severity,
    excerpt: s.excerpt,
    selector: s.locator.value,
  }));
}

export function shouldBlockByPolicy(
  signals: PromptInjectionSignal[],
  policy: 'strict' | 'moderate' | 'permissive'
): boolean {
  switch (policy) {
    case 'strict':
      return signals.some(
        (s) => s.policyRecommendation === 'block' || s.policyRecommendation === 'quarantine'
      );
    case 'moderate':
      return signals.some((s) => s.policyRecommendation === 'block');
    case 'permissive':
      return false;
    default:
      return false;
  }
}
