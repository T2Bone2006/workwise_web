-- Your assistant (2026-10-07): chats, their messages, and the Do it / Cancel actions.
-- Paste after 20261004100300_close_account. Additive only; nothing in Pro reads these tables.
-- Plan: docs/specs/assistant/PLAN.md.
--
-- All reads and writes go through the app's server routes with the service role,
-- after the route has checked who is asking. So RLS is on with no policies for
-- authenticated users: the phone and the browser never touch these tables directly.

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  -- Built once when the chat starts and reused for every turn, so the prompt
  -- prefix never changes (prompt caching, and replayed thinking stays valid).
  system_prompt text NOT NULL,
  -- Which tool set the chat was started with ('rounds', 'lite').
  products text[] NOT NULL DEFAULT '{}',
  surface text NOT NULL DEFAULT 'web',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_conversations_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT assistant_conversations_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT assistant_conversations_surface_check CHECK (surface IN ('web', 'phone')),
  CONSTRAINT assistant_conversations_title_check CHECK (char_length(title) <= 120)
);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user_updated
  ON public.assistant_conversations (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_assistant_conversations_updated_at ON public.assistant_conversations;
CREATE TRIGGER set_assistant_conversations_updated_at
  BEFORE UPDATE ON public.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  role text NOT NULL,
  -- question = what the trader typed (counts toward the monthly allowance);
  -- answer = Claude's reply (one per model call); tool_results = what the tools returned.
  kind text NOT NULL,
  -- Exactly what is sent back to Claude on the next turn (content blocks).
  content jsonb NOT NULL,
  -- What the screen shows for this row (text, cards, action ids); NULL = nothing to show.
  ui jsonb,
  tokens_input integer,
  tokens_output integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT assistant_messages_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_messages_conversation_fkey FOREIGN KEY (conversation_id)
    REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  CONSTRAINT assistant_messages_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT assistant_messages_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT assistant_messages_kind_check CHECK (kind IN ('question', 'answer', 'tool_results'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_seq
  ON public.assistant_messages (conversation_id, seq);
-- The monthly allowance counts questions per business.
CREATE INDEX IF NOT EXISTS idx_assistant_messages_tenant_questions
  ON public.assistant_messages (tenant_id, created_at)
  WHERE kind = 'question';

CREATE TABLE IF NOT EXISTS public.assistant_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tool_use_id text NOT NULL,
  kind text NOT NULL,
  -- The checked, resolved inputs the Do it button runs with.
  params jsonb NOT NULL,
  -- What the card shows: title, lines, button wording.
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error text,
  -- Visit moves and skips: the visit_changes row, for Undo.
  change_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_at timestamp with time zone,
  -- When the outcome was passed back to Claude on the next question.
  noted_at timestamp with time zone,
  CONSTRAINT assistant_actions_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_actions_conversation_fkey FOREIGN KEY (conversation_id)
    REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  CONSTRAINT assistant_actions_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT assistant_actions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT assistant_actions_status_check CHECK (
    status IN ('pending', 'running', 'done', 'cancelled', 'failed', 'undone', 'expired')
  )
);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_conversation
  ON public.assistant_actions (conversation_id, created_at);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_conversations, public.assistant_messages, public.assistant_actions
  FROM anon, authenticated;

COMMENT ON TABLE public.assistant_conversations IS
  'Your assistant: one chat. Server-only (service role); the route checks the user first.';
COMMENT ON TABLE public.assistant_messages IS
  'Your assistant: append-only history. content = Claude API blocks, ui = what the screen draws.';
COMMENT ON TABLE public.assistant_actions IS
  'Your assistant: a change Claude proposed. Nothing happens until the trader taps Do it.';

-- One new AI log type; every existing value is kept.
ALTER TABLE public.ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check;
ALTER TABLE public.ai_interactions ADD CONSTRAINT ai_interactions_interaction_type_check CHECK (
  interaction_type = ANY (ARRAY[
    'skill_detection'::text, 'quote_generation'::text, 'column_mapping'::text,
    'worker_interview_parsing'::text, 'value_transformation'::text, 'date_parsing'::text,
    'description_summary'::text, 'row_extraction'::text, 'customer_row_extraction'::text,
    'message_classification'::text, 'receipt_extraction'::text, 'invoice_drafting'::text,
    'widget_chat'::text, 'lite_interview'::text, 'lite_text_draft'::text, 'conversation_summary'::text,
    'assistant_chat'::text
  ])
);
