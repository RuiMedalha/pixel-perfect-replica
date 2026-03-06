import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type View = "login" | "register" | "forgot";

const AuthPage = () => {
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (view === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Email de recuperação enviado! Verifique a sua caixa de entrada.");
        setView("login");
      }
      return;
    }

    const { error } = view === "login"
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password);
    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else if (view === "register") {
      toast.success("Conta criada! O seu pedido de acesso foi enviado ao administrador.");
      setView("login");
    }
  };

  const titles: Record<View, { title: string; desc: string }> = {
    login: { title: "Entrar", desc: "Introduza as suas credenciais para aceder." },
    register: { title: "Criar Conta", desc: "Preencha para criar a sua conta." },
    forgot: { title: "Recuperar Password", desc: "Introduza o seu email para receber um link de recuperação." },
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-bold">{titles[view].title}</CardTitle>
          <CardDescription>{titles[view].desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            {view !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={view === "login" ? "current-password" : "new-password"}
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {view === "login" ? "Entrar" : view === "register" ? "Criar Conta" : "Enviar Email"}
            </Button>
          </form>
          <div className="mt-4 text-center space-y-2">
            {view === "login" && (
              <>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors block mx-auto"
                  onClick={() => setView("forgot")}
                >
                  Esqueceu a password?
                </button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors block mx-auto"
                  onClick={() => setView("register")}
                >
                  Não tem conta? Criar conta
                </button>
              </>
            )}
            {view === "register" && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setView("login")}
              >
                Já tem conta? Entrar
              </button>
            )}
            {view === "forgot" && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setView("login")}
              >
                Voltar ao login
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthPage;
