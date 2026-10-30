package com.cleanmanager.app.widget;

final class WidgetEvent {
    final String id;       // Firestore 문서 ID — 푸시로 "바뀐 일정만" 다시 읽을 때 캐시에서 찾는 열쇠
    final String title;
    final String start;
    final String end;
    final String startTime;
    final String endTime;
    final boolean allDay;
    final String place;
    final String calId;

    WidgetEvent(String id, String title, String start, String end, String startTime, String endTime,
                boolean allDay, String place, String calId) {
        this.id = id;
        this.title = title;
        this.start = start;
        this.end = end;
        this.startTime = startTime;
        this.endTime = endTime;
        this.allDay = allDay;
        this.place = place;
        this.calId = calId;
    }
}
