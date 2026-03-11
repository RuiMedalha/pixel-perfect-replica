import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, TestTube, Globe } from "lucide-react";
import { useWooSites, useSetActiveWooSite, type WooSite } from "@/hooks/useWooSites";

interface WooSiteSelectorProps {
  value?: string | null;
  onChange?: (siteId: string) => void;
  className?: string;
  /** If true, also sets the global active site when changing */
  setGlobal?: boolean;
}

export function WooSiteSelector({ value, onChange, className, setGlobal }: WooSiteSelectorProps) {
  const { data, isLoading } = useWooSites();
  const setActive = useSetActiveWooSite();

  const sites = data?.sites || [];
  const currentValue = value || data?.activeSiteId || "";

  if (sites.length <= 1) return null;

  const handleChange = (siteId: string) => {
    onChange?.(siteId);
    if (setGlobal) {
      setActive.mutate(siteId);
    }
  };

  const activeSite = sites.find(s => s.id === currentValue);

  return (
    <Select value={currentValue} onValueChange={handleChange}>
      <SelectTrigger className={className || "h-8 text-xs w-48"}>
        <div className="flex items-center gap-1.5 truncate">
          <Globe className="w-3 h-3 shrink-0" />
          <SelectValue placeholder="Selecionar site">
            {activeSite?.name || "Selecionar site"}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SelectItem key={site.id} value={site.id}>
            <div className="flex items-center gap-2">
              {site.isProduction ? (
                <ShieldCheck className="w-3 h-3 text-primary" />
              ) : (
                <TestTube className="w-3 h-3 text-muted-foreground" />
              )}
              <span>{site.name || site.url}</span>
              {site.isProduction && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0">PROD</Badge>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
