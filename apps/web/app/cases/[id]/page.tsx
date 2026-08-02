import { FaultspanPrototype } from "@/components/faultspan-prototype";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FaultspanPrototype initialView="cases" initialCaseId={decodeURIComponent(id)} />;
}
