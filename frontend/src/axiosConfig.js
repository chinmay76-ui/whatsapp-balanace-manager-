// frontend/src/axiosConfig.js
import axios from 'axios';
const API = import.meta.env.VITE_API || 'http://localhost:5000';
axios.defaults.baseURL = API;
export default axios;
