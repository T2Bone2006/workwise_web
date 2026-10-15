import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TOO_LONG,
  interviewMessageError,
  mergePatch,
  missingForFinish,
  parseExampleReply,
  readSetupChat,
  stageReady,
  type DraftProfile,
  type InterviewTurn,
} from '@/lib/lite/interview-schema';
import type { JobType } from '@/lib/lite/profile-schema';

function patch(overrides: Partial<InterviewTurn['patch']> = {}): InterviewTurn['patch'] {
  return {
    areas: null,
    callout_fee: null,
    hourly_rate: null,
    day_rate: null,
    minimum_charge: null,
    materials: null,
    job_types: null,
    rules: null,
    tone: null,
    ...overrides,
  };
}

function job(overrides: Partial<JobType> = {}): JobType {
  return {
    key: 'skim',
    name: 'Skim',
    how_priced: 'from_description',
    guide_min: 80,
    guide_max: 150,
    what_changes_price: 'Room size',
    auto_accept: false,
    ...overrides,
  };
}

function priced(description: string): NonNullable<DraftProfile['example_jobs']>[number] {
  return { description, price: 90, reasoning: 'A normal small room' };
}

describe('mergePatch', () => {
  it('replaces the whole job list and keeps auto-accept on the same key', () => {
    const draft: DraftProfile = {
      job_types: [job({ key: 'lock-change', name: 'Lock change', auto_accept: true })],
      callout_fee: 40,
    };
    const next = mergePatch(
      draft,
      patch({
        job_types: [
          {
            key: 'Lock Change!',
            name: 'Lock change',
            how_priced: 'from_description',
            guide_min: 70,
            guide_max: 120,
            what_changes_price: 'The lock',
          },
          {
            key: 'ceiling skim',
            name: 'Ceiling skim',
            how_priced: 'needs_visit',
            guide_min: null,
            guide_max: null,
            what_changes_price: 'How big the room is',
          },
        ],
      }),
    );
    expect(next.job_types?.map((item) => [item.key, item.auto_accept, item.how_priced])).toEqual([
      ['lock-change', true, 'from_description'],
      ['ceiling-skim', false, 'needs_visit'],
    ]);
    expect(next.job_types?.some((item) => item.key === 'skim')).toBe(false);
  });

  it('drops numbers that are not a real price and leaves unmentioned rates alone', () => {
    const draft: DraftProfile = { callout_fee: 40 };
    const kept = mergePatch(draft, patch({ callout_fee: 0, day_rate: null }));
    expect(kept.callout_fee).toBe(40);
    expect(kept.day_rate).toBeUndefined();

    const tooBig = mergePatch(draft, patch({ callout_fee: 60000 }));
    expect(tooBig.callout_fee).toBe(40);

    const said = mergePatch(draft, patch({ callout_fee: 60 }));
    expect(said.callout_fee).toBe(60);

    const invented = mergePatch(draft, patch({ day_rate: 250 }));
    expect(invented.day_rate).toBe(250);
  });

  it('trims text to the profile limits', () => {
    const next = mergePatch(
      {},
      patch({
        areas: { summary: `  ${'a'.repeat(400)}`, postcodes: ['  M14 1AA  ', ''], max_miles: 12 },
        materials: ` ${'m'.repeat(400)} `,
        rules: ['  No Sundays  ', '   '],
      }),
    );
    expect(next.areas?.summary).toHaveLength(300);
    expect(next.areas?.postcodes).toEqual(['M14 1AA']);
    expect(next.materials).toHaveLength(300);
    expect(next.rules).toEqual(['No Sundays']);
  });
});

describe('stageReady', () => {
  const readyAreas: DraftProfile = { areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: null } };
  const visit = job({ key: 'ceiling', name: 'Ceiling', how_priced: 'needs_visit', guide_min: null, guide_max: null });

  it('is ready for areas only when the summary is filled in', () => {
    expect(stageReady('areas', {})).toBe(false);
    expect(stageReady('areas', { areas: { summary: '   ', postcodes: [], max_miles: null } })).toBe(false);
    expect(stageReady('areas', readyAreas)).toBe(true);
  });

  it('is ready for work when there is at least one kind of work', () => {
    expect(stageReady('work', {})).toBe(false);
    expect(stageReady('work', { job_types: [job()] })).toBe(true);
  });

  it('keeps pricing open until every description-priced job has a range', () => {
    expect(stageReady('pricing', { job_types: [job({ guide_min: null, guide_max: null })] })).toBe(false);
    expect(stageReady('pricing', { job_types: [job({ guide_min: 120, guide_max: 70 })] })).toBe(false);
    expect(stageReady('pricing', { job_types: [job()] })).toBe(true);
    expect(stageReady('pricing', { job_types: [visit] })).toBe(true);
  });

  it('treats rules as always ready, including when there are none', () => {
    expect(stageReady('rules', {})).toBe(true);
    expect(stageReady('rules', { rules: [] })).toBe(true);
  });

  it('needs three priced examples with a reason', () => {
    const two = [priced('One'), priced('Two')];
    const short = [priced('One'), priced('Two'), { description: 'Three', price: 90, reasoning: 'no' }];
    const three = [priced('One'), priced('Two'), priced('Three')];
    expect(stageReady('examples', { example_jobs: two })).toBe(false);
    expect(stageReady('examples', { example_jobs: short })).toBe(false);
    expect(stageReady('examples', { example_jobs: [{ ...priced('Zero'), price: 0 }, ...three] })).toBe(true);
    expect(stageReady('examples', { example_jobs: three })).toBe(true);
  });

  it('leaves the website step to the form, and treats done as ready', () => {
    expect(stageReady('website', readyAreas)).toBe(false);
    expect(stageReady('done', {})).toBe(true);
  });
});

describe('missingForFinish', () => {
  it('lists what is still missing, including at least 3 example jobs', () => {
    expect(missingForFinish({}, null)).toEqual([
      'Say where you work.',
      'Add at least one kind of work.',
      'Price at least 3 example jobs.',
      'Add your website.',
    ]);
    const draft: DraftProfile = {
      areas: { summary: 'South Manchester', postcodes: [], max_miles: null },
      job_types: [job({ guide_min: null, guide_max: null })],
      example_jobs: [priced('One'), priced('Two')],
    };
    expect(missingForFinish(draft, 'daveplastering.co.uk')).toEqual([
      'Add a price range for Skim.',
      'Price at least 3 example jobs.',
    ]);
  });

  it('is empty when the draft and the website are complete', () => {
    const draft: DraftProfile = {
      areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: 12 },
      job_types: [job(), job({ key: 'ceiling', name: 'Ceiling', how_priced: 'needs_visit', guide_min: null, guide_max: null })],
      example_jobs: [priced('One'), priced('Two'), priced('Three')],
      rules: [],
      tone: 'Warm',
      materials: 'Customer buys materials',
    };
    expect(missingForFinish(draft, 'daveplastering.co.uk')).toEqual([]);
  });
});

describe('interviewMessageError', () => {
  it('refuses an empty message and one over 2,000 characters', () => {
    expect(interviewMessageError('   ')).toBe('Type a message first.');
    expect(interviewMessageError('a'.repeat(2000))).toBeNull();
    expect(interviewMessageError('a'.repeat(2001))).toBe(MESSAGE_TOO_LONG);
  });
});

describe('parseExampleReply', () => {
  it('reads a price and the reason around it', () => {
    expect(parseExampleReply("£180 because it's a small bedroom and the walls are sound")).toEqual({
      ok: true,
      price: 180,
      reasoning: "because it's a small bedroom and the walls are sound",
    });
    expect(parseExampleReply('about 95 quid, just a patch')).toMatchObject({ ok: true, price: 95 });
  });

  it('asks for a price or a reason when one is missing', () => {
    expect(parseExampleReply("I'd need to see that first")).toEqual({ ok: false, need: 'price' });
    expect(parseExampleReply('£180')).toEqual({ ok: false, need: 'why' });
  });
});

describe('readSetupChat', () => {
  it('reads the chat marker and ignores a normal draft', () => {
    expect(readSetupChat({})).toBeNull();
    expect(
      readSetupChat({
        setup_chat: { mode: 'examples', prompts: ['Skim a bedroom'], cursor: 0 },
      } as DraftProfile),
    ).toMatchObject({ mode: 'examples', cursor: 0, prompts: ['Skim a bedroom'] });
  });
});
