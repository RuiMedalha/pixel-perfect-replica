import { Package, CheckCircle, Clock, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const stats = [
  { label: "Produtos Pendentes", value: "0", icon: Clock, color: "text-warning" },
  { label: "Produtos Aprovados", value: "0", icon: CheckCircle, color: "text-success" },
  { label: "Total Processados", value: "0", icon: Package, color: "text-primary" },
];

const recentActivity = [
  { action: "Aplicação iniciada", time: "Agora", status: "info" },
];

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <div className="p-6 lg:p-8 space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Visão geral do estado dos seus produtos.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1">{stat.value}</p>
                </div>
                <stat.icon className={`w-10 h-10 ${stat.color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
          <div className="space-y-3">
            {recentActivity.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm">{item.action}</span>
                <span className="text-xs text-muted-foreground">{item.time}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
