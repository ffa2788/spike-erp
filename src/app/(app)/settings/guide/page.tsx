export const dynamic = "force-dynamic";

export default function GuidePage() {
  return (
    <>
      <h1>How the work flows</h1>
      <h2>Sell something</h2>
      <ol>
        <li>Make a quote. The price has to be a real price.</li>
        <li>Accept the quote. That creates the order.</li>
        <li>Ship it. SPIKE takes the oldest released lots.</li>
        <li>Create the invoice. That is when the sale hits the books.</li>
        <li>Record the payment when the money arrives.</li>
      </ol>
      <h2>Buy something</h2>
      <ol>
        <li>Send a purchase order with a real price.</li>
        <li>Receive the goods. The new lot waits for quality.</li>
        <li>Release the lot when the check passes.</li>
        <li>Enter the supplier’s bill, then pay it.</li>
      </ol>
      <h2>Make a batch</h2>
      <ol>
        <li>The recipe cost must be complete, including blends used inside blends.</li>
        <li>Start the batch. Ingredients come out of released stock.</li>
        <li>Finish it. A new lot waits for quality.</li>
        <li>Release it, then print the label and the lot certificate.</li>
      </ol>
      <h2>Check the bank</h2>
      <ol>
        <li>Load the statement, or use the example that is already loaded.</li>
        <li>Match the suggested lines.</li>
        <li>Record a bank fee if the bank took a charge.</li>
        <li>Stop when the page says the bank and the books agree.</li>
      </ol>
      <p>NSF/ANSI 60 products ship only while the certificate is current and the lot used the certified formula.</p>
    </>
  );
}
