type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>
      <p className="mt-6 text-sm text-muted">
        This module is not implemented in the foundation release.
      </p>
    </div>
  );
}
