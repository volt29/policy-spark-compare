import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, DollarSign, Percent, Heart, AlertCircle, ArrowDown, ArrowUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ComparisonTableProps {
  offers: Array<{
    id: string;
    insurer: string;
    data: any;
  }>;
  bestOfferIndex?: number;
}

export function ComparisonTable({ offers, bestOfferIndex }: ComparisonTableProps) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (rowId: string) => {
    setExpandedRows(prev => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const premiums = offers.map(o => o.data?.premium?.total || 0);
  const lowestPremium = Math.min(...premiums.filter(p => p > 0));

  const coverages = offers.map(o => o.data?.coverage?.oc?.sum || 0);
  const highestCoverage = Math.max(...coverages);

  const getPremiumColor = (value: number) => {
    if (!value) return "";
    if (value === lowestPremium) return "text-success font-semibold";
    if (value > lowestPremium * 1.5) return "text-destructive";
    return "";
  };

  const getCoverageColor = (value: number) => {
    if (!value) return "";
    if (value === highestCoverage) return "text-blue-600 font-semibold";
    return "";
  };

  return (
    <Card className="shadow-elevated">
      <CardHeader>
        <CardTitle>Szczegółowe porównanie</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Kategoria</TableHead>
                {offers.map((offer, idx) => (
                  <TableHead key={offer.id} className={cn(
                    idx === bestOfferIndex && "bg-primary/5"
                  )}>
                    <div className="space-y-1">
                      <div className="font-semibold">{offer.insurer}</div>
                      {idx === bestOfferIndex && (
                        <Badge variant="default" className="text-xs">Rekomendowana</Badge>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Premium */}
              <TableRow className="bg-muted/30">
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    Składka miesięczna
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const premium = offer.data?.premium?.total;
                  return (
                    <TableCell key={offer.id} className={cn(
                      idx === bestOfferIndex && "bg-primary/5",
                      getPremiumColor(premium)
                    )}>
                      <div className="flex items-center gap-2">
                        {premium === lowestPremium && <ArrowDown className="w-4 h-4 text-success" />}
                        <span>
                          {premium ? `${premium.toLocaleString('pl-PL')} ${offer.data?.premium?.currency || 'PLN'}` : 'Brak danych'}
                        </span>
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>

              {/* OC Coverage */}
              <TableRow>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Zakres OC
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const ocSum = offer.data?.coverage?.oc?.sum;
                  return (
                    <TableCell key={offer.id} className={cn(
                      idx === bestOfferIndex && "bg-primary/5",
                      getCoverageColor(ocSum)
                    )}>
                      {ocSum ? `${ocSum.toLocaleString('pl-PL')} PLN` : 'Brak danych'}
                    </TableCell>
                  );
                })}
              </TableRow>

              {/* AC Coverage */}
              <TableRow>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Zakres AC
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const acSum = offer.data?.coverage?.ac?.sum;
                  return (
                    <TableCell key={offer.id} className={cn(
                      idx === bestOfferIndex && "bg-primary/5"
                    )}>
                      {acSum ? `${acSum.toLocaleString('pl-PL')} PLN` : 'Brak danych'}
                    </TableCell>
                  );
                })}
              </TableRow>

              {/* Deductible */}
              <TableRow>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-primary" />
                    Franszyza
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const deductible = offer.data?.deductible?.amount;
                  return (
                    <TableCell key={offer.id} className={cn(
                      idx === bestOfferIndex && "bg-primary/5"
                    )}>
                      {deductible ? `${deductible} ${offer.data?.deductible?.currency || 'PLN'}` : 'Brak'}
                    </TableCell>
                  );
                })}
              </TableRow>

              {/* Assistance - Expandable */}
              <TableRow>
                <TableCell colSpan={offers.length + 1} className="p-0">
                  <Collapsible open={expandedRows['assistance']} onOpenChange={() => toggleRow('assistance')}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-2 p-3 hover:bg-muted/50 transition-colors">
                        <Heart className="w-4 h-4 text-primary" />
                        <span className="font-medium">Assistance</span>
                        <ChevronDown className={cn(
                          "w-4 h-4 ml-auto transition-transform",
                          expandedRows['assistance'] && "rotate-180"
                        )} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid" style={{ gridTemplateColumns: `200px repeat(${offers.length}, 1fr)` }}>
                        <div className="p-3"></div>
                        {offers.map((offer, idx) => (
                          <div key={offer.id} className={cn(
                            "p-3 border-t",
                            idx === bestOfferIndex && "bg-primary/5"
                          )}>
                            {offer.data?.assistance && offer.data.assistance.length > 0 ? (
                              <ul className="space-y-1 text-sm">
                                {offer.data.assistance.map((service: string, i: number) => (
                                  <li key={i} className="flex items-start gap-1">
                                    <span className="text-primary mt-0.5">•</span>
                                    <span>{service}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground text-sm">Brak danych</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>

              {/* Exclusions - Expandable */}
              <TableRow>
                <TableCell colSpan={offers.length + 1} className="p-0">
                  <Collapsible open={expandedRows['exclusions']} onOpenChange={() => toggleRow('exclusions')}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-2 p-3 hover:bg-muted/50 transition-colors">
                        <AlertCircle className="w-4 h-4 text-primary" />
                        <span className="font-medium">Wyłączenia</span>
                        <ChevronDown className={cn(
                          "w-4 h-4 ml-auto transition-transform",
                          expandedRows['exclusions'] && "rotate-180"
                        )} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid" style={{ gridTemplateColumns: `200px repeat(${offers.length}, 1fr)` }}>
                        <div className="p-3"></div>
                        {offers.map((offer, idx) => (
                          <div key={offer.id} className={cn(
                            "p-3 border-t",
                            idx === bestOfferIndex && "bg-primary/5"
                          )}>
                            {offer.data?.exclusions && offer.data.exclusions.length > 0 ? (
                              <ul className="space-y-1 text-sm">
                                {offer.data.exclusions.map((exclusion: string, i: number) => (
                                  <li key={i} className="flex items-start gap-1">
                                    <span className="text-destructive mt-0.5">•</span>
                                    <span>{exclusion}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground text-sm">Brak informacji</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
