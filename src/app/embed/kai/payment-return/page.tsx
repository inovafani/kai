import PaymentReturnClient from "./payment-return-client";

type PaymentReturnPageProps = {
  searchParams: Promise<{ session_id?: string; cancelled?: string }>;
};

export default async function PaymentReturnPage({ searchParams }: PaymentReturnPageProps) {
  const params = await searchParams;

  return <PaymentReturnClient sessionId={params.session_id ?? ""} cancelled={params.cancelled === "true"} />;
}
