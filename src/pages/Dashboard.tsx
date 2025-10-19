import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FileText, Users, TrendingUp, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comparisons, setComparisons] = useState<
    Database["public"]["Tables"]["comparisons"]["Row"][]
  >([]);
  const [stats, setStats] = useState({
    thisMonth: 0,
    total: 0,
    clients: 0,
  });

  const loadDashboardData = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setLoading(true);

    try {
      const { data: compData, error: compError } = await supabase
        .from("comparisons")
        .select("*")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (compError) throw compError;

      setComparisons(compData || []);

      // Calculate stats
      const now = new Date();
      const thisMonthCount = (compData || []).filter((c) => {
        const date = new Date(c.created_at);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }).length;

      const { count: clientsCount } = await supabase
        .from("clients")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user?.id);

      setStats({
        thisMonth: thisMonthCount,
        total: compData?.length || 0,
        clients: clientsCount || 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nieznany błąd";
      toast.error("Błąd ładowania danych", { description: message });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }

    loadDashboardData();
  }, [user, navigate, loadDashboardData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const recentComparisons = comparisons.slice(0, 5).map((c) => ({
    id: c.id,
    client: "Klient",
    product: c.product_type || "OC/AC",
    date: new Date(c.created_at).toLocaleDateString("pl-PL"),
    status: c.status === "completed" ? "Ukończone" : "W trakcie",
  }));

  const statsData = [
    { label: "Porównań w tym miesiącu", value: stats.thisMonth.toString(), icon: TrendingUp },
    { label: "Wszystkich porównań", value: stats.total.toString(), icon: FileText },
    { label: "Aktywnych klientów", value: stats.clients.toString(), icon: Users },
  ];

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
              <p className="text-sm text-muted-foreground">Witaj ponownie, Agencie</p>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={signOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Wyloguj
              </Button>
              <Link to="/compare">
                <Button size="lg" className="shadow-md">
                  <Plus className="mr-2 h-4 w-4" />
                  Nowe porównanie
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {statsData.map((stat, index) => (
            <Card key={index} className="shadow-md hover:shadow-lg transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className="h-5 w-5 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent Comparisons */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Ostatnie porównania</CardTitle>
            <CardDescription>
              Twoje najnowsze analizy ofert ubezpieczeniowych
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentComparisons.length > 0 ? (
              <div className="space-y-4">
                {recentComparisons.map((comparison) => (
                  <div
                    key={comparison.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileText className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{comparison.client}</p>
                        <p className="text-sm text-muted-foreground">
                          {comparison.product}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">{comparison.date}</p>
                        <div className="mt-1">
                          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            comparison.status === "Ukończone"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          }`}>
                            {comparison.status}
                          </span>
                        </div>
                      </div>
                      <Link to={`/comparison/${comparison.id}`}>
                        <Button variant="outline" size="sm">
                          Zobacz
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Nie masz jeszcze żadnych porównań</p>
                <Link to="/compare">
                  <Button className="mt-4">
                    <Plus className="mr-2 h-4 w-4" />
                    Utwórz pierwsze porównanie
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="shadow-md hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle>Klienci</CardTitle>
              <CardDescription>Zarządzaj bazą swoich klientów</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" disabled>
                Zobacz klientów (wkrótce)
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-md hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle>Raporty</CardTitle>
              <CardDescription>Eksportuj i udostępniaj porównania</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" disabled>
                Przeglądaj raporty (wkrótce)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
