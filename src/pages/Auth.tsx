import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import logoIcon from "@/assets/logo-icon.png";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Auth logic will be added after Lovable Cloud is enabled
    setTimeout(() => setIsLoading(false), 1500);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Auth logic will be added after Lovable Cloud is enabled
    setTimeout(() => setIsLoading(false), 1500);
  };

  return (
    <div className="min-h-screen bg-gradient-subtle flex flex-col">
      {/* Header */}
      <div className="container mx-auto px-4 py-6">
        <Link to="/" className="inline-flex items-center space-x-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span>Powrót do strony głównej</span>
        </Link>
      </div>

      {/* Auth Form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-elevated">
          <CardHeader className="space-y-4 text-center">
            <div className="flex justify-center">
              <img src={logoIcon} alt="InsurCompare" className="h-12 w-12" />
            </div>
            <div>
              <CardTitle className="text-2xl">Witaj w InsurCompare</CardTitle>
              <CardDescription>
                Zaloguj się lub utwórz konto aby rozpocząć
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login" className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Logowanie</TabsTrigger>
                <TabsTrigger value="signup">Rejestracja</TabsTrigger>
              </TabsList>

              {/* Login Tab */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="agent@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Hasło</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Logowanie..." : "Zaloguj się"}
                  </Button>
                  <div className="text-center">
                    <a href="#" className="text-sm text-muted-foreground hover:text-foreground">
                      Zapomniałeś hasła?
                    </a>
                  </div>
                </form>
              </TabsContent>

              {/* Signup Tab */}
              <TabsContent value="signup">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Imię i nazwisko</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="Jan Kowalski"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-company">Nazwa firmy (opcjonalnie)</Label>
                    <Input
                      id="signup-company"
                      type="text"
                      placeholder="Moja Agencja Ubezpieczeniowa"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="agent@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Hasło</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      required
                      minLength={8}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Tworzenie konta..." : "Utwórz konto"}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Rejestrując się, akceptujesz nasz{" "}
                    <a href="/terms" className="underline hover:text-foreground">
                      Regulamin
                    </a>{" "}
                    i{" "}
                    <a href="/privacy" className="underline hover:text-foreground">
                      Politykę prywatności
                    </a>
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
