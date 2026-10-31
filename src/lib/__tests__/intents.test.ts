import { describe, expect, test } from 'bun:test';

import {
    ALL_INTENTS,
    isFocusHidden,
    isTabMuted,
    isWidgetVisible,
    parseIntents,
    WIDGET_INTENTS,
} from '../intents';
import type { WidgetType } from '../widgetTypes';
import { WIDGET_LABELS } from '../widgetTypes';

const all = [...ALL_INTENTS];

describe('parseIntents', () => {
  test('parses valid JSON and drops unknown ids', () => {
    expect(parseIntents('["lift","bogus","nutrition"]')).toEqual(['lift', 'nutrition']);
    expect(parseIntents('not json')).toEqual([]);
    expect(parseIntents(null)).toEqual([]);
  });
});

describe('isWidgetVisible', () => {
  test('widget shows when one of its focuses is active', () => {
    expect(isWidgetVisible('today_calories', {}, ['nutrition'])).toBe(true);
    expect(isWidgetVisible('today_calories', {}, ['lift'])).toBe(false);
    expect(isWidgetVisible('readiness', {}, ['recovery'])).toBe(true);
    expect(isWidgetVisible('readiness', {}, ['progress'])).toBe(true);
    expect(isWidgetVisible('readiness', {}, ['nutrition'])).toBe(false);
  });

  test('focus-less widgets (text_goal) always show', () => {
    expect(isWidgetVisible('text_goal', {}, ['nutrition'])).toBe(true);
    expect(isWidgetVisible('text_goal', {}, [])).toBe(true);
  });

  test('hidden_intents in config hides under matching focus', () => {
    const cfg = { hidden_intents: ['recovery'] };
    expect(isWidgetVisible('sleep', cfg, ['recovery'])).toBe(false);
    expect(isWidgetVisible('sleep', cfg, ['lift', 'recovery'])).toBe(false);
    // still hidden? sleep has no other focus, so inactive anyway - check a multi-intent widget
    expect(isWidgetVisible('readiness', { hidden_intents: ['progress'] }, ['recovery', 'progress'])).toBe(false);
    expect(isWidgetVisible('readiness', { hidden_intents: ['nutrition'] }, ['recovery'])).toBe(true);
  });

  test('empty active list (ALL) ignores named-intent hides but honours the all marker', () => {
    expect(isWidgetVisible('today_calories', {}, [])).toBe(true);
    // A hide made under RECOVERY doesn't leak into ALL.
    expect(isWidgetVisible('sleep', { hidden_intents: ['recovery'] }, [])).toBe(true);
    // A hide made under ALL persists and hides it there.
    expect(isWidgetVisible('sleep', { hidden_intents: ['all'] }, [])).toBe(false);
    // ...but doesn't leak into a narrowed focus either.
    expect(isWidgetVisible('sleep', { hidden_intents: ['all'] }, ['recovery'])).toBe(true);
  });

  test('isFocusHidden reports all-hidden widgets under ALL only', () => {
    expect(isFocusHidden('sleep', { hidden_intents: ['all'] }, [])).toBe(true);
    expect(isFocusHidden('sleep', { hidden_intents: ['all'] }, ['recovery'])).toBe(false);
    expect(isFocusHidden('sleep', {}, [])).toBe(false);
  });
});

describe('isTabMuted', () => {
  test('meals mutes without nutrition/hydration, un-mutes with either', () => {
    expect(isTabMuted('meals', ['lift'])).toBe(true);
    expect(isTabMuted('meals', ['lift', 'nutrition'])).toBe(false);
    expect(isTabMuted('meals', all)).toBe(false);
  });

  test('empty active list is ALL - never muted', () => {
    expect(isTabMuted('meals', [])).toBe(false);
    expect(isTabMuted('body', [])).toBe(false);
    expect(isTabMuted('analytics', [])).toBe(false);
  });

  test('home/social/more never mute', () => {
    expect(isTabMuted('index', ['nutrition'])).toBe(false);
    expect(isTabMuted('social', ['lift'])).toBe(false);
    expect(isTabMuted('more', [])).toBe(false);
  });

  test('a focus keeps every tab that has relevant content for it', () => {
    // Cardio data lives in Body (health/activity) and Analytics (activity tab).
    expect(isTabMuted('body', ['cardio'])).toBe(false);
    expect(isTabMuted('meals', ['cardio'])).toBe(false);
    expect(isTabMuted('analytics', ['cardio'])).toBe(false);
    // But genuinely unrelated destinations still mute/hide.
    expect(isTabMuted('logbook', ['cardio'])).toBe(true);
    expect(isTabMuted('library', ['cardio'])).toBe(true);
    // Progress keeps its history views.
    expect(isTabMuted('logbook', ['progress'])).toBe(false);
  });
});

describe('coverage', () => {
  test('every widget type has an intent mapping entry', () => {
    for (const t of Object.keys(WIDGET_LABELS) as WidgetType[]) {
      expect(WIDGET_INTENTS[t]).toBeDefined();
    }
  });

  test('every intent owns at least one widget or is deliberately ambient (social)', () => {
    const owned = new Set<string>();
    for (const intents of Object.values(WIDGET_INTENTS)) {
      for (const i of intents) owned.add(i);
    }
    for (const i of ALL_INTENTS) {
      if (i === 'social') continue; // ambient - Feed/map, no widgets
      expect(owned.has(i)).toBe(true);
    }
  });
});
