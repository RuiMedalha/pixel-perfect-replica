import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function PendingApproval() {
  const { signOut, user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-2">
            <Clock className="w-6 h-6 text-amber-500" />
          </div>
          <CardTitle className="text-xl">Conta Pendente</CardTitle>
          <CardDescription>
            O seu pedido de acesso foi recebido e está a aguardar aprovação do administrador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <Button variant="outline" onClick={signOut} className="gap-2">
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
