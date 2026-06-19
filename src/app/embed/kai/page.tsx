import KaiWidgetClient from "./kai-widget-client";

type EmbedKaiPageProps = {
  searchParams: Promise<{ key?: string }>;
};

export default async function EmbedKaiPage({ searchParams }: EmbedKaiPageProps) {
  const params = await searchParams;

  return <KaiWidgetClient widgetKey={params.key ?? ""} />;
}
