type TabEmptyStateProps = {
  title: string;
  description: string;
};

export function TabEmptyState({ title, description }: TabEmptyStateProps) {
  return (
    <div className="rounded-md border border-border bg-surface px-6 py-10 text-center">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="mt-2 text-sm text-muted">{description}</p>
    </div>
  );
}
