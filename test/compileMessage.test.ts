import { describe, expect, it } from 'vitest';
import { submittedErrorLine } from '../src/grader/providers/cafeGrader/compileMessage';

describe('where a grader compile error points in the submitted file', () => {
  it('the first error, whatever name the grader gave the file', () => {
    const msg = "/source/main.cpp: In function 'int main()':\n/source/main.cpp:7:3: error: expected ';' before 'return'\n/source/main.cpp:9:1: error: x\n";
    expect(submittedErrorLine(msg)).toBe(7);
    expect(submittedErrorLine('student.h:12:5: fatal error: vector: No such file')).toBe(12);
    expect(submittedErrorLine('a.c:3: error: old style, no column')).toBe(3);
  });

  it("skips the grader's own driver files", () => {
    const msg = '/source_manager/main.cpp:30:10: error: no matching function\n/source/student.h:4:2: error: x\n';
    expect(submittedErrorLine(msg)).toBe(4);
    expect(submittedErrorLine('/source_manager/main.cpp:30:10: error: y')).toBeNull();
  });

  it('warnings, notes, colours and nothing at all', () => {
    expect(submittedErrorLine('/source/a.cpp:2:1: warning: unused\n/source/a.cpp:3:1: note: here')).toBeNull();
    expect(submittedErrorLine('\x1b[01m\x1b[K/source/a.cpp:5:2:\x1b[m\x1b[K error: x')).toBe(5);
    expect(submittedErrorLine('')).toBeNull();
    expect(submittedErrorLine(null)).toBeNull();
    expect(submittedErrorLine('\n')).toBeNull();
    expect(submittedErrorLine('/source/a.cpp:0:1: error: line 0')).toBeNull();
  });
});
