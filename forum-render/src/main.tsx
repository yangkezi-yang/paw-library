import React from 'react';
import {createRoot} from 'react-dom/client';
import Forum from './page';
import Admin from './admin';
import './styles.css';
import './notification-styles.css';
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/admin')?<Admin/>:<Forum/>);
