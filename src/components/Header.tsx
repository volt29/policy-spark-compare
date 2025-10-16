import { Button } from "@/components/ui/button";
import logoIcon from "@/assets/logo-icon.png";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { useState } from "react";

export const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3">
            <img src={logoIcon} alt="InsurCompare" className="h-8 w-8" />
            <span className="text-xl font-bold text-foreground">
              Insur<span className="text-primary">Compare</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-8">
            <Link to="/features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Funkcje
            </Link>
            <Link to="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Cennik
            </Link>
            <Link to="/about" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              O nas
            </Link>
          </nav>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            <Link to="/auth">
              <Button variant="ghost">Zaloguj się</Button>
            </Link>
            <Link to="/auth">
              <Button>Rozpocznij</Button>
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="h-6 w-6 text-foreground" />
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-border py-4 space-y-4">
            <Link
              to="/features"
              className="block text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Funkcje
            </Link>
            <Link
              to="/pricing"
              className="block text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cennik
            </Link>
            <Link
              to="/about"
              className="block text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              O nas
            </Link>
            <div className="flex flex-col space-y-2 pt-4">
              <Link to="/auth">
                <Button variant="ghost" className="w-full">
                  Zaloguj się
                </Button>
              </Link>
              <Link to="/auth">
                <Button className="w-full">Rozpocznij</Button>
              </Link>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};
