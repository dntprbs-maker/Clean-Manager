package com.cleanmanager.app.widget;

final class WidgetEvent {
    final String title;
    final String start;
    final String end;
    final String startTime;
    final String endTime;
    final boolean allDay;
    final String place;

    WidgetEvent(String title, String start, String end, String startTime, String endTime,
                boolean allDay, String place) {
        this.title = title;
        this.start = start;
        this.end = end;
        this.startTime = startTime;
        this.endTime = endTime;
        this.allDay = allDay;
        this.place = place;
    }
}
