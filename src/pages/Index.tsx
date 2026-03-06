import { Package, CheckCircle, Clock, Activity, Loader2, Brain, BookOpen, Globe, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useProductStats } from "@/hooks/useProducts";
import { useRecentActivity } from "@/hooks/useActivityLog";
import { useTokenUsageSummary } from "@/hooks/useOptimizationLogs";
import { formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";

const actionLabels: Record<string, string> = {
  upload: "Ficheiro carregado",
  optimize: "Produto otimizado",
  publish: "Produto publicado",
  settings_change: "Configurações alteradas",
  error: "Erro ocorrido",
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading } = useProductStats();
  const { data: activity, isLoading: activityLoading } = useRecentActivity();
  const { data: tokenSummary, isLoading: tokenLoading } = useTokenUsageSummary();

  const statCards = [
    { label: "Produtos Pendentes", value: stats?.pending ?? 0, icon: Clock, color: "text-warning" },
    { label: "Produtos Otimizados", value: stats?.optimized ?? 0, icon: CheckCircle, color: "text-success" },
    { label: "Total Processados", value: stats?.total ?? 0, icon: Package, color: "text-primary" },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Visão geral do estado dos seus produtos.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1">
                    {statsLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : stat.value}
                  </p>
                </div>
                <stat.icon className={`w-10 h-10 ${stat.color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Token Usage Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-4 h-4" />
            Consumo de IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tokenLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !tokenSummary || tokenSummary.totalOptimizations === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem otimizações registadas com dados de tokens.</p>
          ) : (
            <div className="space-y-4">
              {/* Token counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-primary">{tokenSummary.totalOptimizations}</p>
                  <p className="text-xs text-muted-foreground">Otimizações</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{tokenSummary.totalTokens.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Tokens</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{tokenSummary.totalPrompt.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Prompt Tokens</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{tokenSummary.totalCompletion.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Completion Tokens</p>
                </div>
              </div>

              {/* Context usage */}
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline" className="text-xs gap-1">
                  <BookOpen className="w-3 h-3" /> Conhecimento: {tokenSummary.withKnowledge}/{tokenSummary.totalOptimizations}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  <Globe className="w-3 h-3" /> Fornecedor: {tokenSummary.withSupplier}/{tokenSummary.totalOptimizations}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  <Database className="w-3 h-3" /> Catálogo: {tokenSummary.withCatalog}/{tokenSummary.totalOptimizations}
                </Badge>
              </div>

              {/* Top sources */}
              {tokenSummary.topSources.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top fontes de conhecimento</h4>
                  <div className="space-y-1">
                    {tokenSummary.topSources.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                        <span>{s.name}</span>
                        <Badge variant="outline" className="text-xs">{s.count} chunks</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Ações Rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Button size="lg" className="h-20 text-base" onClick={() => navigate("/upload")}>
            📁 Carregar Ficheiros
          </Button>
          <Button size="lg" variant="secondary" className="h-20 text-base" onClick={() => navigate("/produtos")}>
            📦 Ver Produtos
          </Button>
          <Button size="lg" variant="outline" className="h-20 text-base" onClick={() => navigate("/configuracoes")}>
            ⚙️ Configurações
          </Button>
        </div>
      </div>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4" />
            Atividade Recente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !activity || activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem atividade registada.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm">{actionLabels[item.action] ?? item.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: pt })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
