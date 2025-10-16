import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, X, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export default function Compare() {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    if (files.length + newFiles.length > 5) {
      toast({
        title: "Zbyt wiele plików",
        description: "Możesz dodać maksymalnie 5 ofert",
        variant: "destructive",
      });
      return;
    }
    setFiles([...files, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length < 2) {
      toast({
        title: "Za mało plików",
        description: "Dodaj przynajmniej 2 oferty do porównania",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    // Processing logic will be added after Lovable Cloud is enabled
    setTimeout(() => {
      setIsProcessing(false);
      toast({
        title: "Porównanie rozpoczęte",
        description: "Przetwarzamy Twoje dokumenty...",
      });
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center space-x-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Powrót
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Nowe porównanie</h1>
              <p className="text-sm text-muted-foreground">Prześlij oferty do analizy</p>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Client Info */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Informacje o kliencie</CardTitle>
                <CardDescription>Opcjonalnie: przypisz porównanie do klienta</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="client-name">Imię i nazwisko klienta</Label>
                    <Input id="client-name" placeholder="Jan Kowalski" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-type">Typ produktu</Label>
                    <Input id="product-type" placeholder="OC/AC, Dom, Życie..." />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* File Upload */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Prześlij oferty</CardTitle>
                <CardDescription>
                  Dodaj od 2 do 5 ofert ubezpieczeniowych (PDF, obrazy)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Upload Area */}
                <div className="relative">
                  <Input
                    id="file-upload"
                    type="file"
                    accept=".pdf,image/*"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor="file-upload"
                    className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-sm font-medium text-foreground mb-1">
                      Kliknij aby przesłać lub przeciągnij pliki
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF lub obrazy, maksymalnie 5 plików
                    </p>
                  </label>
                </div>

                {/* Uploaded Files */}
                {files.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-foreground">
                      Przesłane pliki ({files.length}/5)
                    </p>
                    {files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30"
                      >
                        <div className="flex items-center space-x-3">
                          <FileText className="h-5 w-5 text-primary" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex justify-end space-x-4">
              <Link to="/dashboard">
                <Button type="button" variant="outline">
                  Anuluj
                </Button>
              </Link>
              <Button type="submit" disabled={files.length < 2 || isProcessing} size="lg">
                {isProcessing ? "Przetwarzanie..." : "Rozpocznij porównanie"}
              </Button>
            </div>
          </form>

          {/* Info Box */}
          <Card className="mt-8 bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">i</span>
                </div>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    <strong className="text-foreground">Wskazówka:</strong> Im lepszej jakości
                    pliki prześlesz, tym dokładniejsze będzie porównanie.
                  </p>
                  <p>
                    Natywne PDF-y działają najlepiej. Skany powinny być czytelne i w dobrej
                    rozdzielczości.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
