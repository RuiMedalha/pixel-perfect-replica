import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUserProfiles, useApproveUser, useSetUserRole } from "@/hooks/useUserManagement";
import { CheckCircle, XCircle, Loader2, Shield, User } from "lucide-react";

const AdminUsersPage = () => {
  const { data: users, isLoading } = useUserProfiles();
  const approveUser = useApproveUser();
  const setUserRole = useSetUserRole();

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pending = users?.filter((u) => !u.approved) || [];
  const approved = users?.filter((u) => u.approved) || [];

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Gestão de Utilizadores</h1>
        <p className="text-muted-foreground mt-1">Aprovar pedidos de conta e gerir permissões.</p>
      </div>

      {/* Pending requests */}
      {pending.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              </span>
              Pedidos Pendentes ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Data do Pedido</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(user.created_at).toLocaleDateString("pt-PT", {
                        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={approveUser.isPending}
                        onClick={() => approveUser.mutate({ userId: user.user_id, approve: true })}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" /> Aprovar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Approved users */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilizadores Ativos ({approved.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approved.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>
                    <Select
                      value={user.roles[0] || "user"}
                      onValueChange={(role) =>
                        setUserRole.mutate({ userId: user.user_id, role: role as "admin" | "user" })
                      }
                    >
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">
                          <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Admin</span>
                        </SelectItem>
                        <SelectItem value="user">
                          <span className="flex items-center gap-1"><User className="w-3 h-3" /> Utilizador</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                      Ativo
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={approveUser.isPending}
                      onClick={() => approveUser.mutate({ userId: user.user_id, approve: false })}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Revogar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminUsersPage;
