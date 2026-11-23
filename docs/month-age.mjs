export function calculateMonthAge(birthDate, targetDate) {
    const birth = parseCalendarDate(birthDate);
    const target = parseCalendarDate(targetDate);
    if (!birth || !target)
        throw new Error('invalid_photo_date');
    const calendarDayDifference = calendarDayNumber(target) - calendarDayNumber(birth);
    if (calendarDayDifference < 0)
        throw new Error('photo_before_start');
    const inclusiveDays = calendarDayDifference + 1;
    if (isFirstMonthLeapException(birth, target)) {
        return createContent(inclusiveDays, 1, 0, targetDate);
    }
    if (inclusiveDays <= 30 || compareCalendarDates(target, monthAnniversary(birth, 1)) < 0) {
        return createContent(inclusiveDays, 0, inclusiveDays, targetDate, `${inclusiveDays}天`);
    }
    let months = 0;
    while (compareCalendarDates(monthAnniversary(birth, months + 1), target) <= 0) {
        months += 1;
    }
    const days = calendarDayNumber(target) - calendarDayNumber(monthAnniversary(birth, months));
    return createContent(inclusiveDays, months, days, targetDate);
}
function createContent(inclusiveDays, months, days, targetDate, displayText = days === 0 ? `${months}个月` : `${months}个月${days}天`) {
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return {
        inclusiveDays,
        years,
        months: remainingMonths,
        days,
        displayText: years === 0
            ? displayText
            : remainingMonths === 0
                ? `${years}岁`
                : `${years}岁${remainingMonths}个月`,
        dateText: targetDate.replaceAll('-', '.'),
    };
}
function monthAnniversary(birthDate, monthsAfterBirth) {
    if (!isLeapYear(birthDate.year)
        && birthDate.month === 2
        && birthDate.day === 28
        && monthsAfterBirth === 1) {
        return { year: birthDate.year, month: 3, day: 29 };
    }
    const monthIndex = birthDate.year * 12 + birthDate.month - 1 + monthsAfterBirth;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return { year, month, day: Math.min(birthDate.day, daysInMonth(year, month)) };
}
function isFirstMonthLeapException(birthDate, targetDate) {
    return (!isLeapYear(birthDate.year)
        && birthDate.month === 2
        && birthDate.day === 28
        && targetDate.year === birthDate.year
        && targetDate.month === 3
        && targetDate.day === 29);
}
function parseCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return null;
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
        return null;
    return { year, month, day };
}
function calendarDayNumber(date) {
    const completedYears = date.year - 1;
    let days = completedYears * 365
        + Math.floor(completedYears / 4)
        - Math.floor(completedYears / 100)
        + Math.floor(completedYears / 400);
    for (let month = 1; month < date.month; month += 1) {
        days += daysInMonth(date.year, month);
    }
    return days + date.day;
}
function compareCalendarDates(left, right) {
    if (left.year !== right.year)
        return left.year - right.year;
    if (left.month !== right.month)
        return left.month - right.month;
    return left.day - right.day;
}
function daysInMonth(year, month) {
    if (month === 2)
        return isLeapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
