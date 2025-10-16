import logoIcon from "@/assets/logo-icon.png";
import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <img src={logoIcon} alt="InsurCompare" className="h-8 w-8" />
              <span className="text-lg font-bold text-foreground">
                Insur<span className="text-primary">Compare</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Nowoczesna platforma do porównywania ofert ubezpieczeniowych dla profesjonalistów.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-foreground">Produkt</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/features" className="text-sm text-muted-foreground hover:text-foreground">
                  Funkcje
                </Link>
              </li>
              <li>
                <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
                  Cennik
                </Link>
              </li>
              <li>
                <Link to="/integrations" className="text-sm text-muted-foreground hover:text-foreground">
                  Integracje
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-foreground">Firma</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/about" className="text-sm text-muted-foreground hover:text-foreground">
                  O nas
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-sm text-muted-foreground hover:text-foreground">
                  Kontakt
                </Link>
              </li>
              <li>
                <Link to="/careers" className="text-sm text-muted-foreground hover:text-foreground">
                  Kariera
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-foreground">Prawne</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
                  Polityka prywatności
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground">
                  Regulamin
                </Link>
              </li>
              <li>
                <Link to="/security" className="text-sm text-muted-foreground hover:text-foreground">
                  Bezpieczeństwo
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} InsurCompare. Wszystkie prawa zastrzeżone.
          </p>
        </div>
      </div>
    </footer>
  );
};
