import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../hooks';
import { fdatetime } from '../format';
import { Badge, Card, ErrorBox, Page, Pagination, Spinner } from '../ui';

// Every email the system sent (password resets, invoices). With no email server configured, this is where to read them.
export default function Outbox() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => api('/outbox', { params: { page, page_size: 15 } }), [page]);
  return (
    <Page title="Email outbox" subtitle="A copy of every email the system sends. If no email server is set up, nothing leaves the system - read the messages here.">
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data && <Spinner />}
      {data && data.data.length === 0 && <Card><p className="muted" style={{ margin: 0 }}>No emails yet.</p></Card>}
      {data && data.data.map((mail) => (
        <Card key={mail.id} title={mail.subject} actions={<><Badge tone={mail.delivered ? 'green' : 'gray'}>{mail.delivered ? 'Delivered' : 'Saved only'}</Badge> <small>{fdatetime(mail.created_at)}</small></>}>
          <div className="muted" style={{ marginBottom: 8 }}>To: {mail.to_email}</div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit' }}>{mail.body}</pre>
          {mail.link && <p style={{ marginBottom: 0 }}><a href={mail.link.replace(/^https?:\/\/[^/]+/, '')}>Open the link in this email</a></p>}
        </Card>
      ))}
      <Pagination meta={data && data.meta} onPage={setPage} />
    </Page>
  );
}
