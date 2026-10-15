import { describe, expect, it } from 'vitest';
import {
  blockingAnswerOf,
  flattenJobReportTree,
  followUpAnswerAfterEdit,
  followUpInsertIndex,
  jobReportTree,
  normaliseJobReportFields,
  parseJobReportFields,
  serialiseJobReportFields,
} from '@/lib/jobs/job-report-fields';

const rs = [
  { id: 'customer_in', type: 'yes_no', label: 'Customer in?', required: true },
  {
    id: 'lock_open_method_other',
    type: 'text',
    label: 'How else was the lock opened?',
    show_when: { field: 'lock_open_method', value: 'Other' },
  },
  {
    id: 'walk_away',
    type: 'yes_no',
    label: 'Did you walk away?',
    blocks_completion: true,
  },
  {
    id: 'walk_away_detail',
    type: 'text',
    label: 'Reason for walkaway',
    multiline: true,
    required: true,
    show_when: { field: 'walk_away', value: true },
  },
];

describe('parseJobReportFields', () => {
  it('keeps a real question and drops a broken entry', () => {
    const fields = parseJobReportFields([null, { id: 'customer_in' }, ...rs]);
    expect(fields.map((field) => field.id)).toEqual([
      'customer_in',
      'lock_open_method_other',
      'walk_away',
      'walk_away_detail',
    ]);
    expect(fields[0]?.required).toBe(false);
    expect(fields[3]).toMatchObject({ required: true, multiline: true, blocksCompletion: false });
    expect(fields[2]?.blocksCompletion).toBe(true);
  });
});

describe('jobReportTree', () => {
  it('nests a follow-up under the answer that shows it', () => {
    const fields = parseJobReportFields([
      { id: 'customer_in', type: 'yes_no', label: 'Customer in?' },
      { id: 'shutter', type: 'yes_no', label: 'Shutter engineer?' },
      {
        id: 'how',
        type: 'select',
        label: 'How was the shutter dealt with?',
        options: ['No action', 'Other'],
        show_when: { field: 'shutter', value: true },
      },
      {
        id: 'what',
        type: 'text',
        label: 'What happened?',
        show_when: { field: 'how', value: 'Other' },
      },
    ]);
    const tree = jobReportTree(fields);
    expect(tree.map((node) => node.field.id)).toEqual(['customer_in', 'shutter']);
    expect(tree[1]?.branches.map((branch) => branch.label)).toEqual(['Yes']);
    expect(tree[1]?.branches[0]?.fields[0]?.field.id).toBe('how');
    expect(tree[1]?.branches[0]?.fields[0]?.branches[0]?.fields[0]?.field.id).toBe('what');
    expect(flattenJobReportTree(tree).map((field) => field.id)).toEqual([
      'customer_in',
      'shutter',
      'how',
      'what',
    ]);
    expect(followUpInsertIndex(fields, 'shutter', true)).toBe(4);
  });
});

describe('normaliseJobReportFields', () => {
  it('keeps an id when the wording changes', () => {
    const result = normaliseJobReportFields([
      { id: 'customer_in', label: 'Was the customer there?', type: 'yes_no' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields[0]?.id).toBe('customer_in');
    expect(serialiseJobReportFields(result.fields)).toEqual([
      { id: 'customer_in', type: 'yes_no', label: 'Was the customer there?' },
    ]);
  });

  it('makes an id for a new question and does not write required: false', () => {
    const result = normaliseJobReportFields([
      { label: 'Shutter engineer?', type: 'yes_no', required: false },
      { label: 'What happened?', type: 'text', required: true, showWhen: { field: 'shutter_engineer', value: true } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.map((field) => field.id)).toEqual(['shutter_engineer', 'what_happened']);
    expect(serialiseJobReportFields(result.fields)).toEqual([
      { id: 'shutter_engineer', type: 'yes_no', label: 'Shutter engineer?' },
      {
        id: 'what_happened',
        type: 'text',
        label: 'What happened?',
        required: true,
        show_when: { field: 'shutter_engineer', value: true },
      },
    ]);
  });

  it('refuses a follow-up that points at a later question', () => {
    const result = normaliseJobReportFields([
      {
        id: 'detail',
        label: 'What happened?',
        type: 'text',
        showWhen: { field: 'shutter_engineer', value: true },
      },
      { id: 'shutter_engineer', label: 'Shutter engineer?', type: 'yes_no' },
    ]);
    expect(result).toEqual({ ok: false, error: 'A follow-up has to depend on a question above it.' });
  });

  it('refuses a dropdown without two choices, and a blocking answer that is not a choice', () => {
    expect(
      normaliseJobReportFields([{ label: 'Lock type', type: 'select', options: ['Yale'] }])
    ).toMatchObject({ ok: false });

    expect(
      normaliseJobReportFields([
        {
          label: 'How was the shutter dealt with?',
          type: 'select',
          options: ['Manually overrode', 'Other'],
          blocksCompletion: true,
          blockingValue: 'Drill',
        },
      ])
    ).toEqual({ ok: false, error: 'Choose which answer marks the job as not completed.' });
  });

  it('writes the dropdown answer that marks the job as not completed', () => {
    const result = normaliseJobReportFields([
      {
        id: 'shutter_action',
        label: 'How was the shutter dealt with?',
        type: 'select',
        options: ['No action', 'Other'],
        blocksCompletion: true,
        blockingValue: 'Other',
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serialiseJobReportFields(result.fields)[0]).toMatchObject({
      blocks_completion: true,
      blocking_value: 'Other',
    });
  });

  it('lets No be the Yes/No answer that marks the job as not completed', () => {
    const result = normaliseJobReportFields([
      { id: 'lock_fitted', label: 'Was the lock fitted?', type: 'yes_no', blocksCompletion: true, blockingValue: false },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = serialiseJobReportFields(result.fields);
    expect(stored[0]).toEqual({
      id: 'lock_fitted',
      type: 'yes_no',
      label: 'Was the lock fitted?',
      blocks_completion: true,
      blocking_value: false,
    });
    const reread = parseJobReportFields(stored);
    expect(reread[0]?.blockingValue).toBe(false);
    expect(blockingAnswerOf(reread[0]!)).toBe(false);
  });

  it('moves follow-ups across when a question changes answer type', () => {
    const yesNo = { type: 'yes_no' as const };
    const list = { type: 'select' as const };
    const fromYesNo = [
      { text: 'Yes', from: true },
      { text: 'No', from: false },
      { text: 'Not sure', from: null },
    ];
    expect(followUpAnswerAfterEdit(true, yesNo, { type: 'select', choices: fromYesNo })).toBe('Yes');
    expect(followUpAnswerAfterEdit(false, yesNo, { type: 'select', choices: fromYesNo })).toBe('No');
    expect(followUpAnswerAfterEdit(true, yesNo, { type: 'text', choices: [] })).toBeNull();

    const renamed = [
      { text: 'Drilled', from: 'Drill' },
      { text: 'Other', from: 'Other' },
    ];
    expect(followUpAnswerAfterEdit('Drill', list, { type: 'select', choices: renamed })).toBe('Drilled');
    expect(followUpAnswerAfterEdit('Pick', list, { type: 'select', choices: renamed })).toBeNull();

    const backToYesNo = [
      { text: 'Yes', from: 'Yes' },
      { text: 'Other', from: 'Other' },
    ];
    expect(followUpAnswerAfterEdit('Yes', list, { type: 'yes_no', choices: backToYesNo })).toBe(true);
    expect(followUpAnswerAfterEdit('Other', list, { type: 'yes_no', choices: backToYesNo })).toBeNull();
  });

  it('keeps a Yes/No that blocks on Yes stored the way it always was', () => {
    const stored = [{ id: 'walk_away', type: 'yes_no', label: 'Did you walk away?', blocks_completion: true }];
    const fields = parseJobReportFields(stored);
    expect(blockingAnswerOf(fields[0]!)).toBe(true);
    expect(serialiseJobReportFields(fields)).toEqual(stored);
  });
});
