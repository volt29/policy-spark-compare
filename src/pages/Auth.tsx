import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import logoIcon from "@/assets/logo-icon.png";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("login");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  useEffect(() => {
    // Check if this is a password reset callback
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    if (type === 'recovery') {
      setShowResetPassword(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("login-email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("login-password") as HTMLInputElement).value;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error("Błąd logowania", { description: error.message });
      setIsLoading(false);
    } else {
      toast.success("Zalogowano pomyślnie");
      navigate("/dashboard");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const form = e.target as HTMLFormElement;
    const fullName = (form.elements.namedItem("signup-name") as HTMLInputElement).value;
    const companyName = (form.elements.namedItem("signup-company") as HTMLInputElement).value;
    const email = (form.elements.namedItem("signup-email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("signup-password") as HTMLInputElement).value;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          company_name: companyName,
        },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (error) {
      toast.error("Błąd rejestracji", { description: error.message });
      setIsLoading(false);
    } else {
      toast.success("Konto utworzone!", { 
        description: "Możesz się teraz zalogować" 
      });
      setIsLoading(false);
      
      // Switch to login tab after 1.5 seconds
      setTimeout(() => {
        setActiveTab("login");
      }, 1500);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("reset-email") as HTMLInputElement).value;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });

    if (error) {
      toast.error("Błąd", { description: error.message });
      setIsLoading(false);
    } else {
      toast.success("Link wysłany!", { 
        description: "Sprawdź swoją skrzynkę email" 
      });
      setIsLoading(false);
      setShowForgotPassword(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const form = e.target as HTMLFormElement;
    const password = (form.elements.namedItem("new-password") as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem("confirm-password") as HTMLInputElement).value;

    if (password !== confirmPassword) {
      toast.error("Hasła nie są identyczne");
      setIsLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      toast.error("Błąd", { description: error.message });
      setIsLoading(false);
    } else {
      toast.success("Hasło zmienione!", { 
        description: "Możesz się teraz zalogować" 
      });
      setIsLoading(false);
      setShowResetPassword(false);
      navigate("/dashboard");
    }
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
            {showResetPassword ? (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Ustaw nowe hasło</h3>
                  <p className="text-sm text-muted-foreground">
                    Wprowadź nowe hasło do swojego konta
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nowe hasło</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Potwierdź hasło</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Zmiana hasła..." : "Zmień hasło"}
                </Button>
              </form>
            ) : showForgotPassword ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Resetuj hasło</h3>
                  <p className="text-sm text-muted-foreground">
                    Wyślemy Ci link do zresetowania hasła na email
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="agent@example.com"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Wysyłanie..." : "Wyślij link"}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(false)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Powrót do logowania
                  </button>
                </div>
              </form>
            ) : (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        Zapomniałeś hasła?
                      </button>
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
