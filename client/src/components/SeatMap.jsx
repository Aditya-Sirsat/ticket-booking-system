import React from 'react';

const STATUS_LABEL = {
  available: 'Available',
  held: 'Held',
  offered: 'Offered (waitlist)',
  booked: 'Booked'
};

export default function SeatMap({ seats, selectedIds, onToggleSeat }) {
  const rows = {};
  for (const seat of seats) {
    rows[seat.row_label] = rows[seat.row_label] || [];
    rows[seat.row_label].push(seat);
  }
  const rowLabels = Object.keys(rows).sort();

  return (
    <div className="seat-map">
      <div className="seat-legend">
        <span className="seat-swatch available" /> Available
        <span className="seat-swatch selected" /> Your selection
        <span className="seat-swatch held" /> Held by another customer
        <span className="seat-swatch booked" /> Booked
      </div>
      {rowLabels.map((label) => (
        <div className="seat-row" key={label}>
          <span className="row-label">{label}</span>
          {rows[label]
            .sort((a, b) => a.col_number - b.col_number)
            .map((seat) => {
              const isSelected = selectedIds.includes(seat.show_seat_id);
              const isClickable = seat.status === 'available' || isSelected;
              const classes = ['seat', seat.category?.toLowerCase()];
              if (isSelected) classes.push('selected');
              else classes.push(seat.status);

              return (
                <button
                  key={seat.show_seat_id}
                  className={classes.join(' ')}
                  disabled={!isClickable}
                  title={`${seat.seat_code} · ${seat.category} · ${STATUS_LABEL[seat.status] || seat.status}`}
                  onClick={() => onToggleSeat(seat)}
                >
                  {seat.col_number}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}
