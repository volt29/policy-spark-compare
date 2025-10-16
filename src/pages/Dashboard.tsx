import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FileText, Clock, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

export default function Dashboard() {
  // Mock data - will be replaced with real data from Lovable Cloud
  const recentComparisons = [
    {
      id: 1,
      clientName: "Jan Kowalski",
      productType: "OC/AC",
      offersCount: 3,
      date: "2024-10-15",
      status: "completed",
    },
    {
      id: 2,
      clientName: "Anna Nowak",
      productType: "Ubezpieczenie domu",
      offersCount: 2,
      date: "2024-10-14",
      status: "completed",
    },
    {
      id: 3,
      clientName: "Piotr Wiśniewski",
      productType: "OC/AC",
      offersCount: 4,
      date: "2024-10-12",
      status: "completed",
    },
  ];

  const stats = [
    { label: "Porównania w tym miesiącu", value: "24", icon: FileText, color: "text-primary" },
    { label: "Zaoszczędzony czas", value: "16h", icon: Clock, color: "text-accent" },
    { label: "Zadowoleni klienci", value: "95%", icon: TrendingUp, color: "text-success" },
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
            <Link to="/compare">
              <Button size="lg" className="shadow-md">
                <Plus className="mr-2 h-4 w-4" />
                Nowe porównanie
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {stats.map((stat, index) => (
            <Card key={index} className="shadow-md hover:shadow-lg transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
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
                      <p className="font-medium text-foreground">{comparison.clientName}</p>
                      <p className="text-sm text-muted-foreground">
                        {comparison.productType} • {comparison.offersCount} oferty
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">{comparison.date}</p>
                      <div className="mt-1">
                        <span className="inline-flex items-center rounded-full bg-success-light px-2 py-1 text-xs font-medium text-success">
                          Zakończone
                        </span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm">
                      Zobacz
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {recentComparisons.length === 0 && (
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
              <Button variant="outline" className="w-full">
                Zobacz klientów
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-md hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle>Raporty</CardTitle>
              <CardDescription>Eksportuj i udostępniaj porównania</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                Przeglądaj raporty
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
