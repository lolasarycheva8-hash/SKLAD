import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export function NoAccessibleSections() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      data-testid="state-no-accessible-sections"
    >
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <ShieldAlert className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Нет доступных разделов
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Обратитесь к администратору, чтобы получить доступ к нужным разделам.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}