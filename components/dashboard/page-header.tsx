export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
