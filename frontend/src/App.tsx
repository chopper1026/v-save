import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import UserCenter from './pages/UserCenter'
import AdminUsers from './pages/AdminUsers'

function App() {
  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/user" element={<UserCenter />} />
        <Route path="/vip" element={<Navigate to="/user" replace />} />
        <Route path="/admin" element={<AdminUsers />} />
        <Route path="/admin/users" element={<Navigate to="/admin?tab=users" replace />} />
      </Routes>
    </div>
  )
}

export default App
