import { Button } from "@/components/ui/button";
import { ArrowRight, FileCheck2, Zap, Shield } from "lucide-react";
import heroImage from "@/assets/hero-insurcompare.jpg";
import { Link } from "react-router-dom";

export const Hero = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-subtle py-20 lg:py-32">
      <div className="container mx-auto px-4">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
          {/* Left column - Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Porównuj oferty ubezpieczeniowe w{" "}
                <span className="bg-gradient-primary bg-clip-text text-transparent">
                  minutę
                </span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Platforma dla agentów i brokerów ubezpieczeniowych. Automatyczna analiza polis, 
                czytelne porównania i profesjonalne raporty dla Twoich klientów.
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              <Link to="/auth">
                <Button size="lg" className="group">
                  Rozpocznij za darmo
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Link to="/dashboard">
                <Button size="lg" variant="outline">
                  Zobacz demo
                </Button>
              </Link>
            </div>

            {/* Features list */}
            <div className="grid gap-4 pt-8 sm:grid-cols-3">
              <div className="flex items-start space-x-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Błyskawiczne</p>
                  <p className="text-sm text-muted-foreground">OCR + AI w sekundach</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
                  <FileCheck2 className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Dokładne</p>
                  <p className="text-sm text-muted-foreground">Inteligentne mapowanie</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                  <Shield className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Bezpieczne</p>
                  <p className="text-sm text-muted-foreground">RODO & audyt</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right column - Hero image */}
          <div className="relative">
            <div className="relative overflow-hidden rounded-2xl shadow-elevated">
              <img
                src={heroImage}
                alt="InsurCompare Dashboard Preview"
                className="w-full h-auto"
              />
            </div>
            {/* Floating badge */}
            <div className="absolute -bottom-4 -left-4 rounded-xl bg-card p-4 shadow-lg border border-border">
              <p className="text-sm font-medium text-muted-foreground">Zaufało nam już</p>
              <p className="text-2xl font-bold text-foreground">500+ agentów</p>
            </div>
          </div>
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 right-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-1/2 left-0 h-[500px] w-[500px] rounded-full bg-accent/5 blur-3xl" />
      </div>
    </section>
  );
};
