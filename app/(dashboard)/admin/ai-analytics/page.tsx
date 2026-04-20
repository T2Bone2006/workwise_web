import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/utils/admin';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function AIAnalyticsPage() {
  const admin = await isAdmin();
  if (!admin) {
    redirect('/dashboard');
  }

  const supabase = await createClient();

  let performance: Array<{
    interaction_type: string;
    total_interactions?: number;
    accuracy_percentage?: number;
    total_cost_usd?: number;
    avg_cost_per_interaction?: number;
    avg_latency_ms?: number;
    avg_rating?: number;
  }> = [];
  let readiness: Array<{
    interaction_type: string;
    total_examples?: number;
    clean_examples?: number;
    corrected_examples?: number;
    readiness_status?: string;
  }> = [];
  let recentInteractions: Array<{
    id: string;
    interaction_type: string;
    created_at: string;
    latency_ms: number | null;
    cost_usd: number | null;
    user_edited: boolean | null;
    accepted: boolean | null;
    tenants?: { name: string | null } | null;
    tenant_id?: string;
  }> = [];
  let totalCost = 0;
  let costCount = 0;

  const { data: perf } = await supabase
    .from('ai_performance_summary')
    .select('*');
  if (perf) performance = perf;

  const { data: read } = await supabase
    .from('ai_training_readiness')
    .select('*');
  if (read) readiness = read;

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: costData } = await supabase
    .from('ai_interactions')
    .select('cost_usd')
    .gte('created_at', thirtyDaysAgo);

  if (costData) {
    costCount = costData.length;
    totalCost =
      costData.reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0) || 0;
  }

  const { data: recent } = await supabase
    .from('ai_interactions')
    .select(
      `
      id,
      interaction_type,
      created_at,
      latency_ms,
      cost_usd,
      user_edited,
      accepted,
      tenant_id
    `
    )
    .order('created_at', { ascending: false })
    .limit(20);

  if (recent) recentInteractions = recent;

  // Resolve tenant names if we have tenant_id
  const tenantIds = [...new Set(recentInteractions.map((r) => r.tenant_id).filter(Boolean))] as string[];
  let tenantNames: Record<string, string> = {};
  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name')
      .in('id', tenantIds);
    if (tenants) {
      tenantNames = Object.fromEntries(
        tenants.map((t) => [t.id, t.name ?? 'Unknown'])
      );
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-yellow-900 dark:text-yellow-100">
              Admin Only – Confidential Data
            </h3>
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              This page contains AI performance metrics, costs, and training
              data across all tenants. Do not share this information publicly.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-3xl font-bold">AI Performance & Training Data</h1>
        <p className="text-muted-foreground">
          Track AI accuracy and collect training data for custom models (Admin
          View)
        </p>
      </div>

      <Card className="border-purple-200 dark:border-purple-800">
        <CardHeader>
          <CardTitle>Cost Summary (Last 30 Days)</CardTitle>
          <CardDescription>
            Total AI API costs across all tenants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold text-purple-600 dark:text-purple-400">
            ${totalCost.toFixed(2)}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {costCount} total API calls
          </p>
        </CardContent>
      </Card>

      {performance.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {performance.map((p) => (
            <Card key={p.interaction_type}>
              <CardHeader>
                <CardTitle className="text-lg capitalize">
                  {p.interaction_type.replace(/_/g, ' ')}
                </CardTitle>
                <CardDescription>
                  {p.total_interactions ?? 0} interactions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {p.accuracy_percentage != null && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Accuracy
                      </span>
                      <span className="font-medium">
                        {p.accuracy_percentage}%
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total Cost
                    </span>
                    <span className="font-medium">
                      ${Number(p.total_cost_usd ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      Avg Cost
                    </span>
                    <span className="font-medium">
                      ${Number(p.avg_cost_per_interaction ?? 0).toFixed(4)}
                    </span>
                  </div>
                  {p.avg_latency_ms != null && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Avg Latency
                      </span>
                      <span className="font-medium">
                        {p.avg_latency_ms}ms
                      </span>
                    </div>
                  )}
                  {p.avg_rating != null && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        User Rating
                      </span>
                      <span className="font-medium">⭐ {p.avg_rating}/5</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {readiness.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Training Data Readiness</CardTitle>
            <CardDescription>
              Progress toward custom AI model training (10,000 examples = ready)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {readiness.map((r) => (
                <div key={r.interaction_type} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium capitalize">
                      {r.interaction_type.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={`text-sm px-2 py-1 rounded ${
                        r.readiness_status === 'Ready for training'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : r.readiness_status === 'Approaching readiness'
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      {r.readiness_status ?? 'Collecting data'}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.min(
                          ((r.total_examples ?? 0) / 10000) * 100,
                          100
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      {(r.total_examples ?? 0).toLocaleString()} examples
                    </span>
                    <span>
                      {r.clean_examples ?? 0} clean • {r.corrected_examples ?? 0}{' '}
                      corrected
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent AI Interactions</CardTitle>
          <CardDescription>
            Last 20 API calls across all tenants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentInteractions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No interactions recorded yet.
              </p>
            ) : (
              recentInteractions.map((interaction) => (
                <div
                  key={interaction.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        interaction.accepted && !interaction.user_edited
                          ? 'bg-green-500'
                          : interaction.user_edited
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <div>
                      <p className="font-medium capitalize text-sm">
                        {interaction.interaction_type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {interaction.tenant_id
                          ? tenantNames[interaction.tenant_id] ?? interaction.tenant_id
                          : 'Unknown tenant'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{interaction.latency_ms ?? '—'}ms</span>
                    <span>
                      $
                      {Number(interaction.cost_usd ?? 0).toFixed(4)}
                    </span>
                    <span className="text-xs">
                      {new Date(
                        interaction.created_at
                      ).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
