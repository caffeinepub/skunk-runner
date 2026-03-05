export function Header() {
  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">
                UK
              </span>
            </div>
            <div>
              <h2 className="font-semibold text-foreground">
                Inflation Tracker
              </h2>
              <p className="text-xs text-muted-foreground">
                Regional Price Comparison
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
