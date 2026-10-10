import React from 'react';
import './StaticIdBadge.css';
import { formatStaticId } from '../utils/storage';

function StaticIdBadge({ staticId }) {
  const id = formatStaticId(staticId);
  if (!id) return null;

  return <span className="static-id">#{id}</span>;
}

export default StaticIdBadge;
