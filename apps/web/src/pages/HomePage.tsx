import { useNavigate } from 'react-router-dom'

export default function HomePage() {
  const navigate = useNavigate()

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      gap: '2rem',
      padding: '2rem',
    }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 700 }}>
        AI Presentation Coach
      </h1>
      <p style={{ color: '#aaa', fontSize: '1.1rem', textAlign: 'center', maxWidth: '480px' }}>
        Real-time AI coaching during your live presentation.
        Share your screen, start speaking — get instant feedback.
      </p>
      <button
        onClick={() => navigate('/session')}
        style={{
          padding: '1rem 2.5rem',
          fontSize: '1.1rem',
          fontWeight: 600,
          background: '#4f46e5',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
        }}
      >
        Start Session
      </button>
    </div>
  )
}
