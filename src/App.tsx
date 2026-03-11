import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useCurrentUserProfile } from "@/hooks/useUserManagement";
import { WorkspaceProvider } from "@/hooks/useWorkspaces";
import { PendingApproval } from "@/components/PendingApproval";
import Index from "./pages/Index";
import UploadPage from "./pages/UploadPage";
import ProductsPage from "./pages/ProductsPage";
import SettingsPage from "./pages/SettingsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import CategoriesPage from "./pages/CategoriesPage";
import VariationsPage from "./pages/VariationsPage";
import WooImportPage from "./pages/WooImportPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useCurrentUserProfile();

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Check if user is approved
  if (profile && !profile.isApproved) {
    return <PendingApproval />;
  }

  return (
    <WorkspaceProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Index />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/variacoes" element={<VariationsPage />} />
          <Route path="/categorias" element={<CategoriesPage />} />
          <Route path="/importar-woo" element={<WooImportPage />} />
          {profile?.isAdmin && (
            <>
              <Route path="/configuracoes" element={<SettingsPage />} />
              <Route path="/admin/utilizadores" element={<AdminUsersPage />} />
            </>
          )}
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </WorkspaceProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <AuthPage />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthRoute />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
