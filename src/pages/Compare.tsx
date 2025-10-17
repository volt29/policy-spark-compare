import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, X, FileText, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sanitizeFileName } from "@/lib/sanitizeFileName";

export default function Compare() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [productType, setProductType] = useState("");

  useEffect(() => {
    if (!user) {
      navigate("/auth");
    }
  }, [user, navigate]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    
    // Validation 1: Max 5 files
    if (files.length + newFiles.length > 5) {
      toast.error("Maksymalnie 5 plików");
      return;
    }
    
    // Validation 2: Max file size (10MB)
    const oversized = newFiles.filter(f => f.size > 10 * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error("Plik za duży", { 
        description: `Maksymalny rozmiar: 10MB. Plik "${oversized[0].name}" jest za duży.` 
      });
      return;
    }
    
    // Validation 3: Allowed file types
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const invalidTypes = newFiles.filter(f => !allowedTypes.includes(f.type));
    if (invalidTypes.length > 0) {
      toast.error("Nieprawidłowy format", { 
        description: "Akceptowane formaty: PDF, JPG, PNG, WEBP" 
      });
      return;
    }
    
    setFiles([...files, ...newFiles]);
    toast.success(`Dodano ${newFiles.length} plik(ów)`);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length < 2) {
      toast.error("Dodaj minimum 2 oferty do porównania");
      return;
    }

    if (!user) {
      toast.error("Musisz być zalogowany");
      navigate("/auth");
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Upload files to Storage
      setProcessingStage("Przesyłanie plików...");
      const uploadPromises = files.map(async (file) => {
        const safeName = sanitizeFileName(file.name);
        const fileName = `${user.id}/${Date.now()}-${safeName}`;
        const { data, error } = await supabase.storage
          .from("insurance-documents")
          .upload(fileName, file);

        if (error) throw error;
        return { path: data.path, file };
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      toast.success("Pliki przesłane pomyślnie");

      // 2. Create document records
      const documentPromises = uploadedFiles.map(async ({ path, file }) => {
        const { data, error } = await supabase
          .from("documents")
          .insert({
            user_id: user.id,
            file_name: file.name,
            file_path: path,
            file_size: file.size,
            mime_type: file.type,
            status: "uploaded",
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      });

      const documents = await Promise.all(documentPromises);
      const documentIds = documents.map((d) => d.id);

      // 3. Extract data from each document
      setProcessingStage("Ekstrahowanie danych z dokumentów...");
      const extractionPromises = documents.map((doc) =>
        supabase.functions.invoke("extract-insurance-data", {
          body: { document_id: doc.id },
        })
      );

      await Promise.all(extractionPromises);
      
      // 3.5. Wait for extraction to complete (polling)
      setProcessingStage("Czekam na ekstrakcję danych...");
      const maxAttempts = 30; // 30 * 2s = 60s timeout
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        const { data: docs } = await supabase
          .from('documents')
          .select('id, status, extracted_data')
          .in('id', documentIds);
        
        if (!docs) {
          throw new Error('Nie można sprawdzić statusu dokumentów');
        }
        
        const allCompleted = docs.every(d => d.status === 'completed');
        const anyFailed = docs.some(d => d.status === 'failed');
        
        if (allCompleted) {
          toast.success("Dane wyekstrahowane pomyślnie");
          break;
        }
        
        if (anyFailed) {
          const failedDocs = docs.filter(d => d.status === 'failed');
          throw new Error(`Nie udało się przetworzyć ${failedDocs.length} dokumentu(ów). Spróbuj ponownie z innymi plikami.`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        throw new Error('Przekroczono limit czasu przetwarzania dokumentów. Spróbuj ponownie z mniejszymi plikami.');
      }

      // 4. Create comparison
      const { data: comparison, error: compError } = await supabase
        .from("comparisons")
        .insert({
          user_id: user.id,
          product_type: productType || "OC/AC",
          document_ids: documentIds,
          status: "processing",
        })
        .select()
        .single();

      if (compError) throw compError;

      // 5. Compare offers
      setProcessingStage("Porównywanie ofert...");
      await supabase.functions.invoke("compare-offers", {
        body: { comparison_id: comparison.id },
      });

      // 6. Generate summary
      setProcessingStage("Generowanie podsumowania AI...");
      await supabase.functions.invoke("generate-summary", {
        body: { comparison_id: comparison.id },
      });

      toast.success("Porównanie gotowe!");
      setProcessingStage("");
      navigate(`/comparison/${comparison.id}`);
    } catch (error: any) {
      console.error("Error during comparison:", error);
      
      // Parse specific errors
      let errorMessage = "Wystąpił błąd podczas przetwarzania";
      
      if (error.message?.includes("Invalid key")) {
        errorMessage = "Błąd: Nazwa pliku zawiera niedozwolone znaki. Spróbuj zmienić nazwę pliku.";
      } else if (error.message?.includes("storage")) {
        errorMessage = "Błąd przesyłania pliku. Sprawdź czy plik nie jest za duży (max 10MB).";
      } else if (error.message?.includes("functions")) {
        errorMessage = "Błąd przetwarzania AI. Spróbuj ponownie za chwilę.";
      }
      
      toast.error("Błąd podczas przetwarzania", { 
        description: errorMessage
      });
      setIsProcessing(false);
      setProcessingStage("");
    }
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
                    <Input
                      id="client-name"
                      placeholder="Jan Kowalski"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-type">Typ produktu</Label>
                    <Input
                      id="product-type"
                      placeholder="np. OC/AC"
                      value={productType}
                      onChange={(e) => setProductType(e.target.value)}
                    />
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
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {processingStage || "Przetwarzanie..."}
                  </>
                ) : (
                  "Rozpocznij porównanie"
                )}
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
