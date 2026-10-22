"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, ReceiptText } from "lucide-react";
import { api, apiBase } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";

type Sale = {
  id: string;
  invoiceNumber: string;
  totalAmount: string;
  taxAmount: string;
  paymentMethod: string;
  createdAt: string;
  branch?: { name: string; organization: { currency: string } } | null;
  user: { name: string | null };
};
type SaleResponse = { data: Sale[]; page: number; pageSize: number };
const money = (value: string, currency = "COP") =>
  formatCurrency(value, currency);
const paymentName: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

export default function ReportsPage() {
  const [page, setPage] = useState(1);
  const sales = useQuery({
    queryKey: ["sales", page],
    queryFn: () => api<SaleResponse>(`/sales?page=${page}&pageSize=25`),
  });
  async function downloadCsv() {
    const response = await fetch(`${apiBase}/api/reports/sales.csv`, {
      credentials: "include",
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ventas.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function downloadPdf() {
    const blob = await api<Blob>("/reports/sales.pdf");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "reporte-ventas.pdf";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="reports-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> INFORMACIÓN COMERCIAL
          </div>
          <h1>
            Reportes<span className="heading-comma">.</span>
          </h1>
          <p className="page-subtitle">
            Ventas y comprobantes con acceso a su detalle.
          </p>
        </div>
        <div className="export-actions">
          <button
            className="secondary-button export-button"
            onClick={downloadCsv}
          >
            <FileSpreadsheet size={16} /> Exportar CSV <Download size={15} />
          </button>
          <button
            className="secondary-button export-button"
            onClick={downloadPdf}
          >
            <FileText size={16} /> Exportar PDF <Download size={15} />
          </button>
        </div>
      </section>
      <section className="report-table-panel">
        <div className="table-topline">
          <div>
            <ReceiptText size={17} />
            <strong>Ventas recientes</strong>
          </div>
          <span>ÚLTIMAS OPERACIONES</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>COMPROBANTE</th>
                <th>FECHA</th>
                <th>SEDE</th>
                <th>VENDEDOR</th>
                <th>PAGO</th>
                <th>IMPUESTO</th>
                <th>TOTAL</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {sales.data?.data.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <strong className="invoice-number">
                      {sale.invoiceNumber}
                    </strong>
                  </td>
                  <td>
                    {new Intl.DateTimeFormat("es-CO", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(sale.createdAt))}
                  </td>
                  <td>{sale.branch?.name ?? "—"}</td>
                  <td>{sale.user.name ?? "—"}</td>
                  <td>
                    {paymentName[sale.paymentMethod] ?? sale.paymentMethod}
                  </td>
                  <td>{money(sale.taxAmount, sale.branch?.organization.currency)}</td>
                  <td>
                    <strong>{money(sale.totalAmount, sale.branch?.organization.currency)}</strong>
                  </td>
                  <td>
                    <a
                      className="receipt-download"
                      href={`${apiBase}/api/receipts/${sale.id}.pdf`}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir comprobante PDF"
                    >
                      <Download size={15} />
                    </a>
                  </td>
                </tr>
              ))}
              {!sales.data?.data.length && (
                <tr>
                  <td colSpan={8} className="table-empty">
                    {sales.isLoading
                      ? "Cargando ventas…"
                      : "Aún no hay ventas registradas."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="report-pagination">
          <span>Página {page}</span>
          <div>
            <button
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <button
              className="secondary-button"
              disabled={(sales.data?.data.length ?? 0) < 25}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>
      {sales.isError && (
        <div className="notice error">{sales.error.message}</div>
      )}
    </div>
  );
}
